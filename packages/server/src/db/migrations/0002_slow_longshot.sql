CREATE TABLE IF NOT EXISTS "channel_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"user_id" uuid,
	"snapshot" jsonb NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" varchar(20) NOT NULL,
	"certificate_pem" text NOT NULL,
	"private_key_pem" text,
	"fingerprint" varchar(95) NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "content" text;