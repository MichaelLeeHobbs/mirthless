-- ===========================================================================
-- Partition the six message-storage parent tables by LIST (channel_id)
-- ===========================================================================
-- PostgreSQL cannot convert a plain table to a partitioned one in place, so
-- each parent is dropped and recreated as PARTITION BY LIST (channel_id) with a
-- DEFAULT partition. PartitionManagerService.createPartitions() then attaches a
-- per-channel partition at channel creation; the DEFAULT partition is a fail-safe
-- so inserts for a channel whose partition was not (yet) created still land.
--
-- DESTRUCTIVE: this drops and recreates the message tables. It is safe only
-- because these tables carry no production data in this pre-release phase and
-- have no foreign keys referencing them. There is intentionally no data-copy.
-- The column/PK/index shapes below mirror the Drizzle schema exactly.
--> statement-breakpoint
DROP TABLE IF EXISTS "messages" CASCADE;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigserial NOT NULL,
	"channel_id" uuid NOT NULL,
	"server_id" varchar(36),
	"correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"original_message_id" bigint,
	"import_id" bigint,
	"import_channel_id" uuid,
	CONSTRAINT "messages_channel_id_id_pk" PRIMARY KEY("channel_id","id")
) PARTITION BY LIST ("channel_id");--> statement-breakpoint
CREATE TABLE "messages_default" PARTITION OF "messages" DEFAULT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_received_idx" ON "messages" USING btree ("channel_id","received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_processed_idx" ON "messages" USING btree ("channel_id","processed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_correlation_idx" ON "messages" USING btree ("correlation_id");--> statement-breakpoint
DROP TABLE IF EXISTS "connector_messages" CASCADE;--> statement-breakpoint
CREATE TABLE "connector_messages" (
	"channel_id" uuid NOT NULL,
	"message_id" bigint NOT NULL,
	"meta_data_id" integer NOT NULL,
	"status" varchar(20) NOT NULL,
	"connector_name" varchar(255),
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"send_date" timestamp with time zone,
	"response_date" timestamp with time zone,
	"error_code" integer DEFAULT 0 NOT NULL,
	"chain_id" integer DEFAULT 0 NOT NULL,
	"order_id" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_messages_channel_id_message_id_meta_data_id_pk" PRIMARY KEY("channel_id","message_id","meta_data_id")
) PARTITION BY LIST ("channel_id");--> statement-breakpoint
CREATE TABLE "connector_messages_default" PARTITION OF "connector_messages" DEFAULT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_messages_status_idx" ON "connector_messages" USING btree ("channel_id","meta_data_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_messages_queued_idx" ON "connector_messages" USING btree ("channel_id","meta_data_id","status") WHERE status = 'QUEUED';--> statement-breakpoint
DROP TABLE IF EXISTS "message_content" CASCADE;--> statement-breakpoint
CREATE TABLE "message_content" (
	"channel_id" uuid NOT NULL,
	"message_id" bigint NOT NULL,
	"meta_data_id" integer NOT NULL,
	"content_type" integer NOT NULL,
	"content" text,
	"data_type" varchar(50),
	"is_encrypted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "message_content_channel_id_message_id_meta_data_id_content_type_pk" PRIMARY KEY("channel_id","message_id","meta_data_id","content_type")
) PARTITION BY LIST ("channel_id");--> statement-breakpoint
CREATE TABLE "message_content_default" PARTITION OF "message_content" DEFAULT;--> statement-breakpoint
DROP TABLE IF EXISTS "message_custom_metadata" CASCADE;--> statement-breakpoint
CREATE TABLE "message_custom_metadata" (
	"channel_id" uuid NOT NULL,
	"message_id" bigint NOT NULL,
	"meta_data_id" integer NOT NULL,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "message_custom_metadata_channel_id_message_id_meta_data_id_pk" PRIMARY KEY("channel_id","message_id","meta_data_id")
) PARTITION BY LIST ("channel_id");--> statement-breakpoint
CREATE TABLE "message_custom_metadata_default" PARTITION OF "message_custom_metadata" DEFAULT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_custom_metadata_gin" ON "message_custom_metadata" USING gin ("metadata");--> statement-breakpoint
DROP TABLE IF EXISTS "message_attachments" CASCADE;--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" varchar(255) NOT NULL,
	"channel_id" uuid NOT NULL,
	"message_id" bigint NOT NULL,
	"mime_type" varchar(100),
	"segment_id" integer DEFAULT 0 NOT NULL,
	"attachment_size" integer NOT NULL,
	"content" text NOT NULL,
	"is_encrypted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "message_attachments_channel_id_id_segment_id_pk" PRIMARY KEY("channel_id","id","segment_id")
) PARTITION BY LIST ("channel_id");--> statement-breakpoint
CREATE TABLE "message_attachments_default" PARTITION OF "message_attachments" DEFAULT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_attachments_message_idx" ON "message_attachments" USING btree ("channel_id","message_id");--> statement-breakpoint
DROP TABLE IF EXISTS "message_statistics" CASCADE;--> statement-breakpoint
CREATE TABLE "message_statistics" (
	"channel_id" uuid NOT NULL,
	"meta_data_id" integer NOT NULL,
	"server_id" varchar(36) NOT NULL,
	"received" bigint DEFAULT 0 NOT NULL,
	"filtered" bigint DEFAULT 0 NOT NULL,
	"sent" bigint DEFAULT 0 NOT NULL,
	"errored" bigint DEFAULT 0 NOT NULL,
	"received_lifetime" bigint DEFAULT 0 NOT NULL,
	"filtered_lifetime" bigint DEFAULT 0 NOT NULL,
	"sent_lifetime" bigint DEFAULT 0 NOT NULL,
	"errored_lifetime" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "message_statistics_channel_id_meta_data_id_server_id_pk" PRIMARY KEY("channel_id","meta_data_id","server_id")
) PARTITION BY LIST ("channel_id");--> statement-breakpoint
CREATE TABLE "message_statistics_default" PARTITION OF "message_statistics" DEFAULT;
