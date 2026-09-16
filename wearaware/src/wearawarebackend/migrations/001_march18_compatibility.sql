-- Apply after restoring wearaware_march18.sql for the current backend.
BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS gmail TEXT;
ALTER TABLE public.detections ADD COLUMN IF NOT EXISTS worker_id INTEGER
  REFERENCES public.workers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  temp_password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
