CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"driver" varchar(32) DEFAULT 'postgres' NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 5432 NOT NULL,
	"database" varchar(255) NOT NULL,
	"db_user" varchar(255) NOT NULL,
	"password_encrypted" text NOT NULL,
	"read_only" boolean DEFAULT true NOT NULL,
	"max_connections" integer DEFAULT 5 NOT NULL,
	"statement_timeout_ms" integer DEFAULT 30000 NOT NULL,
	"max_rows" integer DEFAULT 10000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_sources_name_unique" UNIQUE("name")
);
