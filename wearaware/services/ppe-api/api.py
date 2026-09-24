"""
PPE Detection API — FastAPI Backend
Run locally: python -m uvicorn api:app --host 127.0.0.1 --port 8000
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
import cv2
import numpy as np
from ultralytics import YOLO
from PIL import Image
import io
import base64
import time
import os
import secrets
import asyncio
from pathlib import Path
from dotenv import load_dotenv
from starlette.concurrency import run_in_threadpool
load_dotenv(Path(__file__).with_name(".env"))
API_KEY = os.getenv("AI_API_KEY", "")
if len(API_KEY) < 32:
    raise RuntimeError("Configure AI_API_KEY with at least 32 characters.")
MAX_UPLOAD = 2 * 1024 * 1024
MAX_PIXELS = 4_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
inference_gate = asyncio.Semaphore(1)

# ─────────────────────────────────────────────
#  APP SETUP
# ─────────────────────────────────────────────
app = FastAPI(
    title="PPE Detection API",
    description="Real-time Personal Protective Equipment detection using YOLOv11",
    version="1.0.0"
)

# The browser calls Express; only the trusted backend may call this service.
@app.middleware("http")
async def protect_service(request, call_next):
    if not secrets.compare_digest(request.headers.get("x-api-key", "").encode(), API_KEY.encode()):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if request.method == "POST":
        try:
            length = int(request.headers.get("content-length", "-1"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_UPLOAD + 16384:
            return JSONResponse({"error": "Invalid upload size"}, status_code=413)
    try:
        response = await call_next(request)
    except Exception:
        response = JSONResponse({"error": "Detection failed. Please retry."}, status_code=500)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response

# ─────────────────────────────────────────────
#  CONSTANTS
#  Model classes: {0: 'helmet', 1: 'human', 2: 'no-helmet', 3: 'vest'}
# ─────────────────────────────────────────────
WEIGHTS_PATH = os.getenv("WEIGHTS_PATH", str(Path(__file__).with_name("best.pt")))

VIOLATION_KEYWORDS = ['no-helmet', 'no-vest']   # no-vest is inferred

NON_PPE = ['human']

# Per-class minimum confidence — stricter than the global floor
MIN_CONF_PER_CLASS = {
    'helmet'   : 0.35,
    'no-helmet': 0.35,
    'vest'     : 0.25,
}

# How tall the inferred no-vest box is, relative to the helmet box height
# Increased to cover more of the body when helmet box is small
VEST_INFER_SCALE = 4.0

# Minimum absolute height of the inferred torso box in pixels
# prevents tiny helmet boxes from producing uselessly small torso regions
VEST_MIN_TORSO_HEIGHT = 120


# ─────────────────────────────────────────────
#  MODEL LOADING (once at startup)
# ─────────────────────────────────────────────
model = None

@app.on_event("startup")
def load_model():
    global model
    if not os.path.exists(WEIGHTS_PATH):
        raise RuntimeError("Model weights are unavailable.")
    model = YOLO(WEIGHTS_PATH)
    print(f"✅ Model loaded — {len(model.names)} classes: {list(model.names.values())}")


# ─────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────
def is_violation(name: str) -> bool:
    return name.lower() in VIOLATION_KEYWORDS


def frame_to_base64(frame: np.ndarray) -> str:
    """Convert OpenCV frame to base64 string for sending to React."""
    _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buffer).decode('utf-8')


def boxes_overlap_horizontally(b1, b2, tolerance=0.4):
    """Check if two [x1,y1,x2,y2] boxes share enough horizontal space."""
    overlap = min(b1[2], b2[2]) - max(b1[0], b2[0])
    width1  = b1[2] - b1[0]
    return overlap >= width1 * tolerance


def infer_no_vest(helmet_boxes, vest_boxes, frame_shape):
    """
    For each helmet/no-helmet box, estimate the torso region below it.
    If no vest box overlaps that region, flag it as a no-vest violation.
    Returns a list of inferred no-vest bounding boxes [x1, y1, x2, y2].
    """
    inferred = []
    for hx1, hy1, hx2, hy2 in helmet_boxes:
        h_height = hy2 - hy1
        h_width  = hx2 - hx1

        # Widen the torso box — vest is usually wider than the helmet box
        padding  = int(h_width * 0.3)
        torso_x1 = max(0, hx1 - padding)
        torso_x2 = min(frame_shape[1], hx2 + padding)

        # Use whichever is taller: scaled height or the minimum floor
        torso_height = max(int(h_height * VEST_INFER_SCALE), VEST_MIN_TORSO_HEIGHT)
        torso = [
            torso_x1,
            hy2,
            torso_x2,
            min(hy2 + torso_height, frame_shape[0])
        ]
        has_vest = any(boxes_overlap_horizontally(torso, list(vb)) for vb in vest_boxes)
        if not has_vest:
            inferred.append(torso)
    return inferred


def infer_no_helmet(helmet_boxes, vest_boxes, frame_shape):
    """
    For each vest box, check if a helmet/no-helmet box exists above it.
    If not, infer a no-helmet violation above the vest.
    Returns a list of inferred no-helmet bounding boxes [x1, y1, x2, y2].
    """
    inferred = []
    for vx1, vy1, vx2, vy2 in vest_boxes:
        v_height = vy2 - vy1
        v_width  = vx2 - vx1

        # Estimate head region above the vest
        head_height = max(int(v_height * 0.6), 80)
        head_x1     = max(0, vx1 + int(v_width * 0.1))
        head_x2     = min(frame_shape[1], vx2 - int(v_width * 0.1))
        head_region = [
            head_x1,
            max(0, vy1 - head_height),
            head_x2,
            vy1
        ]

        # Check if any helmet/no-helmet box overlaps the head region
        has_helmet = any(
            boxes_overlap_horizontally(head_region, list(hb))
            for hb in helmet_boxes
        )
        if not has_helmet:
            inferred.append(head_region)
    return inferred


def run_detection(frame: np.ndarray, conf: float = 0.40, iou: float = 0.5):
    """Run YOLO detection and return annotated frame + structured results."""

    # Use the passed conf as the model-level floor (minimum 0.10 to avoid junk)
    # MIN_CONF_PER_CLASS then applies stricter per-class filtering on top
    model_conf = max(conf, 0.10)
    results = model.predict(frame, conf=model_conf, iou=min(iou, 0.35), agnostic_nms=False, verbose=False)[0]

    detections   = []
    violations   = []
    compliant    = []
    helmet_boxes = []   # collect for vest inference
    vest_boxes   = []   # collect for vest inference
    human_boxes  = []   # lets checkpoint mode flag a person with no recognised PPE at all

    annotated = frame.copy()

    for box in (results.boxes or []):
        cls_id     = int(box.cls[0])
        conf_score = float(box.conf[0])
        name       = model.names[cls_id]
        x1, y1, x2, y2 = map(int, box.xyxy[0])

        # A person is not displayed as PPE, but it is useful evidence when the
        # model recognises a person while recognising neither helmet nor vest.
        if name in NON_PPE:
            human_boxes.append([x1, y1, x2, y2])
            continue

        # Per-class confidence filter
        min_conf = MIN_CONF_PER_CLASS.get(name, conf)
        if conf_score < min_conf:
            continue

        viol  = is_violation(name)
        color = (60, 80, 248) if viol else (63, 185, 80)   # BGR: red vs green

        # Draw solid box
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
        label = f"{name}  {conf_score:.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.52, 1)
        cv2.rectangle(annotated, (x1, max(0, y1 - th - 8)), (x1 + tw + 6, y1), color, -1)
        cv2.putText(annotated, label, (x1 + 3, y1 - 3),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1)

        detections.append({
            "class_id"  : cls_id,
            "class_name": name,
            "confidence": round(conf_score, 4),
            "bbox"      : {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            "violation" : viol,
            "inferred"  : False
        })

        if viol:
            violations.append(name)
        else:
            compliant.append(name)

        # Collect positions for vest inference
        if name in ('helmet', 'no-helmet'):
            helmet_boxes.append([x1, y1, x2, y2])
        elif name == 'vest':
            vest_boxes.append([x1, y1, x2, y2])

    # ── Infer no-vest violations ──────────────────────────────────────────
    if helmet_boxes:
        for (nx1, ny1, nx2, ny2) in infer_no_vest(helmet_boxes, vest_boxes, frame.shape):

            # Draw dashed red box for inferred no-vest
            color, dash = (0, 0, 220), 12
            for x in range(nx1, nx2, dash * 2):
                cv2.line(annotated, (x, ny1), (min(x + dash, nx2), ny1), color, 2)
                cv2.line(annotated, (x, ny2), (min(x + dash, nx2), ny2), color, 2)
            for y in range(ny1, ny2, dash * 2):
                cv2.line(annotated, (nx1, y), (nx1, min(y + dash, ny2)), color, 2)
                cv2.line(annotated, (nx2, y), (nx2, min(y + dash, ny2)), color, 2)

            label = "no-vest (inferred)"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.50, 1)
            cv2.rectangle(annotated, (nx1, max(0, ny1 - th - 8)), (nx1 + tw + 6, ny1), color, -1)
            cv2.putText(annotated, label, (nx1 + 3, ny1 - 3),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.50, (255, 255, 255), 1)

            violations.append('no-vest')
            detections.append({
                "class_id"  : -1,
                "class_name": "no-vest",
                "confidence": 0.0,
                "bbox"      : {"x1": nx1, "y1": ny1, "x2": nx2, "y2": ny2},
                "violation" : True,
                "inferred"  : True
            })

    # ── Infer no-helmet violations ────────────────────────────────────────
    # Only infer if NO helmet/no-helmet was detected anywhere in the frame
    # Safe for checkpoint mode (one person at a time)
    if vest_boxes and not helmet_boxes:
        for (nx1, ny1, nx2, ny2) in infer_no_helmet(helmet_boxes, vest_boxes, frame.shape):

            # Draw dashed red box for inferred no-helmet
            color, dash = (0, 0, 220), 12
            for x in range(nx1, nx2, dash * 2):
                cv2.line(annotated, (x, ny1), (min(x + dash, nx2), ny1), color, 2)
                cv2.line(annotated, (x, ny2), (min(x + dash, nx2), ny2), color, 2)
            for y in range(ny1, ny2, dash * 2):
                cv2.line(annotated, (nx1, y), (nx1, min(y + dash, ny2)), color, 2)
                cv2.line(annotated, (nx2, y), (nx2, min(y + dash, ny2)), color, 2)

            label = "no-helmet (inferred)"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.50, 1)
            cv2.rectangle(annotated, (nx1, max(0, ny1 - th - 8)), (nx1 + tw + 6, ny1), color, -1)
            cv2.putText(annotated, label, (nx1 + 3, ny1 - 3),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.50, (255, 255, 255), 1)

            violations.append('no-helmet')
            detections.append({
                "class_id"  : -1,
                "class_name": "no-helmet",
                "confidence": 0.0,
                "bbox"      : {"x1": nx1, "y1": ny1, "x2": nx2, "y2": ny2},
                "violation" : True,
                "inferred"  : True
            })

    # ── Infer an unprotected person ───────────────────────────────────────
    # The model can identify a person even when neither PPE item is visible.
    # The earlier rules cover a helmet-only or vest-only person; this fills in
    # the remaining case without adding duplicate violations for those rules.
    if human_boxes and not helmet_boxes and not vest_boxes:
        for hx1, hy1, hx2, hy2 in human_boxes:
            person_width = hx2 - hx1
            person_height = hy2 - hy1
            if person_width < 40 or person_height < 100:
                continue

            head = [hx1, hy1, hx2, hy1 + max(40, int(person_height * 0.30))]
            torso = [hx1, head[3], hx2, hy2]
            for label, (nx1, ny1, nx2, ny2) in (("no-helmet", head), ("no-vest", torso)):
                color, dash = (0, 0, 220), 12
                for x in range(nx1, nx2, dash * 2):
                    cv2.line(annotated, (x, ny1), (min(x + dash, nx2), ny1), color, 2)
                    cv2.line(annotated, (x, ny2), (min(x + dash, nx2), ny2), color, 2)
                for y in range(ny1, ny2, dash * 2):
                    cv2.line(annotated, (nx1, y), (nx1, min(y + dash, ny2)), color, 2)
                    cv2.line(annotated, (nx2, y), (nx2, min(y + dash, ny2)), color, 2)
                cv2.putText(annotated, f"{label} (inferred)", (nx1 + 3, max(16, ny1 - 4)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.50, color, 2)
                violations.append(label)
                detections.append({
                    "class_id"  : -1,
                    "class_name": label,
                    "confidence": 0.0,
                    "bbox"      : {"x1": nx1, "y1": ny1, "x2": nx2, "y2": ny2},
                    "violation" : True,
                    "inferred"  : True
                })

    # ── Status banner on frame ────────────────────────────────────────────
    h, w = annotated.shape[:2]
    if violations:
        cv2.rectangle(annotated, (0, 0), (w, 38), (40, 30, 180), -1)
        cv2.putText(annotated, f"  VIOLATION  |  {', '.join(set(violations))}",
                    (8, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)
    elif compliant:
        cv2.rectangle(annotated, (0, 0), (w, 38), (30, 130, 50), -1)
        cv2.putText(annotated, "  ALL PPE COMPLIANT",
                    (8, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)
    else:
        cv2.rectangle(annotated, (0, 0), (w, 38), (60, 80, 100), -1)
        cv2.putText(annotated, "  NO PPE DETECTED",
                    (8, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)

    return annotated, detections, violations, compliant


# ─────────────────────────────────────────────
#  ROUTES
# ─────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "PPE Detection API is running 🦺"}


@app.get("/health")
def health():
    if model is None:
        raise HTTPException(status_code=503, detail="Model unavailable")
    return {
        "status"      : "ok",
        "model_loaded": model is not None,
        "classes"     : list(model.names.values()) if model else []
    }


@app.post("/detect")
async def detect(
    file        : UploadFile = File(...),
    conf        : float = 0.15,
    iou         : float = 0.5,
    return_image: bool = True
):
    """
    Detect PPE in an uploaded image.

    Returns:
    - detections: list of detected objects with class, confidence, bbox, inferred flag
    - violations: list of violation class names (including inferred no-vest)
    - compliant: list of compliant PPE class names
    - is_compliant: bool — True if no violations found
    - annotated_image: base64 encoded annotated image (if return_image=True)
    - inference_time_ms: how long detection took
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded. Check weights path.")

    if file.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(status_code=400, detail="JPEG or PNG required")
    if not 0.1 <= conf <= 1 or not 0 < iou <= 1:
        raise HTTPException(status_code=400, detail="Invalid detection parameters")
    contents = await file.read(MAX_UPLOAD + 1)
    if len(contents) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="Image too large")
    try:
        with Image.open(io.BytesIO(contents)) as image:
            if image.width * image.height > MAX_PIXELS or image.format not in ("JPEG", "PNG"):
                raise ValueError("Invalid image")
            image.verify()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or oversized image")
    np_arr   = np.frombuffer(contents, np.uint8)
    frame    = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")

    t0 = time.time()
    try:
        await asyncio.wait_for(inference_gate.acquire(), timeout=0.1)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Detection service busy")
    try:
        annotated, detections, violations, compliant = await run_in_threadpool(run_detection, frame, conf, iou)
    finally:
        inference_gate.release()
    inference_ms = round((time.time() - t0) * 1000, 2)

    response = {
        "detections"       : detections,
        "violations"       : list(set(violations)),
        "compliant"        : list(set(compliant)),
        "is_compliant"     : len(violations) == 0,
        "total_detections" : len(detections),
        "inference_time_ms": inference_ms,
    }

    if return_image:
        response["annotated_image"] = frame_to_base64(annotated)

    return JSONResponse(content=response)
