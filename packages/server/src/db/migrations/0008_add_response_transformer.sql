-- Add per-destination response transformer script column.
-- Runs on a destination's response after a successful send. Null = none.
ALTER TABLE "channel_connectors" ADD COLUMN IF NOT EXISTS "response_transformer" text;
