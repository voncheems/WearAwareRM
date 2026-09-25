const router = require('express').Router();
const multer = require('multer');
const { requireAuth, requireRole } = require('../middleware');
const { limiter } = require('../security');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 1, fieldSize: 20, parts: 2 },
  fileFilter(req, file, cb) { cb(null, ['image/jpeg', 'image/png'].includes(file.mimetype)); } });
router.post('/detect', requireAuth, requireRole('scanner'), limiter(60, 60 * 1000, { keyGenerator: req => String(req.user.id) }), upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Upload one JPEG or PNG image (maximum 2 MB).' });
  const conf = Number(req.body.conf ?? 0.35);
  if (!Number.isFinite(conf) || conf < 0.1 || conf > 1) return res.status(400).json({ error: 'Invalid confidence threshold.' });
  if (!process.env.AI_API_KEY) return res.status(503).json({ error: 'Detection service is not configured.' });
  try {
    const url = new URL('/detect', process.env.AI_API_URL || 'http://127.0.0.1:8000');
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return res.status(503).json({ error: 'Detection service requires a secure connection.' });
    // FastAPI declares conf as a query parameter, not a multipart form field.
    url.searchParams.set('conf', String(conf));
    // The live browser video remains visible. Returning an annotated base64 image
    // for every inference adds a large tunnel round trip with no effect on verdicts.
    url.searchParams.set('return_image', 'false');
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), 'ppe-image');
    const response = await fetch(url, { method: 'POST', headers: { 'X-API-Key': process.env.AI_API_KEY }, body: form, signal: AbortSignal.timeout(25000), redirect: 'error' });
    if (!response.ok) return res.status(503).json({ error: 'Detection service is unavailable. Please retry the scan.' });
    const result = await response.json();
    if (!Array.isArray(result.detections) || typeof result.is_compliant !== 'boolean' || !Number.isInteger(result.total_detections)) return res.status(502).json({ error: 'Invalid detection service response.' });
    res.json(result);
  } catch (err) {
    if (['TimeoutError', 'AbortError', 'TypeError'].includes(err.name)) return res.status(503).json({ error: 'Detection service is unavailable. Please retry the scan.' });
    next(err);
  }
});
module.exports = router;
