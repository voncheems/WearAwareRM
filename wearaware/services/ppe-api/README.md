# Protected PPE inference service

This is the secured copy of Desktop/testppedetect/api.py and best.pt. Streamlit is not needed by WearAware.

Use a Python environment with requirements.txt installed. Start from this directory:

```sh
python -m uvicorn api:app --host 127.0.0.1 --port 8000
```

On the current development computer, the existing model environment can start the new service from the project root:

```sh
"$HOME/Desktop/testppedetect/.venv/bin/python" -m uvicorn api:app --app-dir services/ppe-api --host 127.0.0.1 --port 8000
```

AI_API_KEY in this folder's ignored .env must match the backend key. The API requires that key in X-API-Key, including health requests. The frontend never receives it: authenticated inspectors upload through Express /api/ppe/detect. Do not use the original unprotected API for production.

Only /detect is exposed for inference; the unused batch endpoint was removed. There is a 2 MB file limit, 4-million-pixel image limit, query-parameter bounds, and one active inference per process. Actual model startup fails if weights are missing. `/health` is an API-key-protected readiness check; `/healthz` is a minimal public liveness check for Render and returns 503 when the model is unavailable.

Tests: `python -m unittest discover -s services/ppe-api -p 'test_*.py'` from the project root. These use a fake predictor; separately run real model checks before production. Dependency ranges are development constraints, not a reproducible production lock. Resolve and pin a clean production environment before deployment.

The inference slot covers image validation/decoding, inference, and optional annotation encoding. Overload returns 503 before decoding another image. Readiness remains available while work runs in the thread pool. Multipart upload parsing still occurs before route admission, so this is not an unlimited-load guarantee. Run only one Uvicorn worker on a small instance; every worker loads its own model.

Reproduce memory measurements in a fresh local process using the existing inference environment:

```sh
python services/ppe-api/benchmark_memory.py --requests 20
python services/ppe-api/benchmark_memory.py --requests 20 --width 2000 --height 2000 --annotated
```

The benchmark uses synthetic JPEGs and an isolated dummy key, runs the real weights through upload decoding and inference, and prints only timing and process peak RSS. It does not contact Render or Atlas or print image data. `resource` requires a Unix-like platform. It does not include the ASGI server/network overhead or measure PPE accuracy. macOS and Linux memory measurements are not interchangeable. A 512 MB deployment remains unverified until sustained inference is measured on that instance; use a higher-memory instance if it still exceeds the limit instead of lowering safety thresholds.

For a real localhost HTTP check, run `python services/ppe-api/verify_local_service.py --requests 20` in the same inference environment. It starts and stops its own Uvicorn process on an ephemeral loopback port, uses a dummy key and synthetic images, and reports startup, sequential latency, a two-request cold burst, sampled server-process RSS, input rejection, a deliberate client timeout and recovery. It cannot target production or access Atlas. The 100 ms RSS samples can miss brief peaks; on Linux the sampler reads process high-water RSS when available. Expected overload 503 responses are counted separately from unexpected failures. Synthetic images do not measure detection accuracy.

See ../../docs/SECURITY.md for the full application security and rollout instructions.
