CREATE TABLE "collection_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"payload" text,
	"expire_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"indexed_fields" jsonb NOT NULL,
	"default_ttl_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_records_fields_idx" ON "collection_records" USING gin ("fields");--> statement-breakpoint
CREATE INDEX "collection_records_created_idx" ON "collection_records" USING btree ("collection_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "collection_records_expire_idx" ON "collection_records" USING btree ("expire_at") WHERE expire_at is not null;