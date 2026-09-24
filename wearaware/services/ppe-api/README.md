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

Only /detect is exposed for inference; the unused batch endpoint was removed. There is a 2 MB file limit, 4-million-pixel image limit, query-parameter bounds, and one active inference per process. Actual model startup fails if weights are missing. Health returns 503 when no model is loaded.

Tests: `python -m unittest discover -s services/ppe-api -p 'test_*.py'` from the project root. These use a fake predictor; separately run real model checks before production. Dependency ranges are development constraints, not a reproducible production lock. Resolve and pin a clean production environment before deployment.

See ../../docs/SECURITY.md for the full application security and rollout instructions.
