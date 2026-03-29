ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_correlation_idx" ON "messages" USING btree ("correlation_id");
