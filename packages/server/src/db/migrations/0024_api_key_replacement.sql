ALTER TABLE "api_keys" ADD COLUMN "replace_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "replace_warned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "previous_secret_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "previous_secret_until" timestamp with time zone;