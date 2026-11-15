ALTER TABLE "channel_connectors" ADD COLUMN "response_transformer_language" varchar(20) DEFAULT 'JAVASCRIPT' NOT NULL;--> statement-breakpoint
ALTER TABLE "filter_rules" ADD COLUMN "language" varchar(20) DEFAULT 'JAVASCRIPT' NOT NULL;--> statement-breakpoint
ALTER TABLE "transformer_steps" ADD COLUMN "language" varchar(20) DEFAULT 'JAVASCRIPT' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_scripts" ADD COLUMN "language" varchar(20) DEFAULT 'JAVASCRIPT' NOT NULL;--> statement-breakpoint
ALTER TABLE "global_scripts" ADD COLUMN "language" varchar(20) DEFAULT 'JAVASCRIPT' NOT NULL;