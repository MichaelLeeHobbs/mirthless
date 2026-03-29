ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "script_timeout_seconds" integer NOT NULL DEFAULT 30;
