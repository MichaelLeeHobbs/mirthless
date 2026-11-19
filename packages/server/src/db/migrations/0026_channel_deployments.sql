CREATE TABLE "channel_deployment_adoptions" (
	"channel_id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_deployments" (
	"channel_id" uuid PRIMARY KEY NOT NULL,
	"channel_revision" integer NOT NULL,
	"format" integer NOT NULL,
	"channel" jsonb NOT NULL,
	"code_templates" jsonb NOT NULL,
	"global_scripts" jsonb NOT NULL,
	"deployed_by" uuid,
	"deployed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undeployed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "channel_deployment_adoptions" ADD CONSTRAINT "channel_deployment_adoptions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_deployments" ADD CONSTRAINT "channel_deployments_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- An install upgrading with enabled channels has no deployment records yet.
-- Its first start records each one's saved configuration as its deployment,
-- once, so the channels come back as they did before the upgrade (D-323).
-- A new install has no channels here, so it never adopts anything.
INSERT INTO "channel_deployment_adoptions" ("channel_id")
SELECT "id" FROM "channels" WHERE "enabled" AND "deleted_at" IS NULL;
