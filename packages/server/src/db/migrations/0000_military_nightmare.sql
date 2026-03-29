CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"description" text,
	"role" varchar(50) DEFAULT 'viewer' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token" varchar(500) NOT NULL,
	"user_agent" varchar(500),
	"ip_address" varchar(45),
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_refresh_token_unique" UNIQUE("refresh_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resource" varchar(50) NOT NULL,
	"action" varchar(20) NOT NULL,
	"scope" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_preferences" (
	"user_id" uuid NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text,
	CONSTRAINT "user_preferences_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '',
	"enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"inbound_data_type" varchar(50) NOT NULL,
	"outbound_data_type" varchar(50) NOT NULL,
	"initial_state" varchar(20) DEFAULT 'STOPPED' NOT NULL,
	"message_storage_mode" varchar(20) DEFAULT 'DEVELOPMENT' NOT NULL,
	"encrypt_data" boolean DEFAULT false NOT NULL,
	"remove_content_on_completion" boolean DEFAULT false NOT NULL,
	"remove_attachments_on_completion" boolean DEFAULT false NOT NULL,
	"pruning_enabled" boolean DEFAULT false NOT NULL,
	"pruning_max_age_days" integer,
	"pruning_archive_enabled" boolean DEFAULT false NOT NULL,
	"source_connector_type" varchar(50) NOT NULL,
	"source_connector_properties" jsonb NOT NULL,
	"response_mode" varchar(30) DEFAULT 'AUTO_AFTER_DESTINATIONS' NOT NULL,
	"response_connector_name" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"last_deployed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"meta_data_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"connector_type" varchar(50) NOT NULL,
	"properties" jsonb NOT NULL,
	"queue_mode" varchar(20) DEFAULT 'NEVER' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"retry_interval_ms" integer DEFAULT 10000 NOT NULL,
	"rotate_queue" boolean DEFAULT false NOT NULL,
	"queue_thread_count" integer DEFAULT 1 NOT NULL,
	"chain_id" integer DEFAULT 0 NOT NULL,
	"order_in_chain" integer DEFAULT 0 NOT NULL,
	"wait_for_previous" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"connector_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "filter_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filter_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"operator" varchar(10) DEFAULT 'AND' NOT NULL,
	"type" varchar(30) NOT NULL,
	"name" varchar(255),
	"script" text,
	"field" varchar(255),
	"condition" varchar(50),
	"values" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_transformers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"connector_id" uuid,
	"inbound_data_type" varchar(50) NOT NULL,
	"outbound_data_type" varchar(50) NOT NULL,
	"inbound_properties" jsonb NOT NULL,
	"outbound_properties" jsonb NOT NULL,
	"inbound_template" text,
	"outbound_template" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transformer_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transformer_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"name" varchar(255),
	"type" varchar(30) NOT NULL,
	"script" text,
	"source_field" varchar(500),
	"target_field" varchar(500),
	"default_value" text,
	"mapping" varchar(30)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"script_type" varchar(30) NOT NULL,
	"script" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_metadata_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"data_type" varchar(20) NOT NULL,
	"mapping_expression" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_dependencies" (
	"channel_id" uuid NOT NULL,
	"depends_on_channel_id" uuid NOT NULL,
	CONSTRAINT "channel_dependencies_channel_id_depends_on_channel_id_pk" PRIMARY KEY("channel_id","depends_on_channel_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_group_members" (
	"channel_group_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	CONSTRAINT "channel_group_members_channel_group_id_channel_id_pk" PRIMARY KEY("channel_group_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '',
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_tag_assignments" (
	"channel_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "channel_tag_assignments_channel_id_tag_id_pk" PRIMARY KEY("channel_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(7),
	CONSTRAINT "channel_tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "code_template_libraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '',
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_template_libraries_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "code_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '',
	"type" varchar(20) NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"contexts" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alert_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"action_type" varchar(30) NOT NULL,
	"recipients" jsonb NOT NULL,
	"properties" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alert_channels" (
	"alert_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	CONSTRAINT "alert_channels_alert_id_channel_id_pk" PRIMARY KEY("alert_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '',
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger_type" varchar(30) NOT NULL,
	"trigger_script" text,
	"subject_template" text,
	"body_template" text,
	"re_alert_interval_ms" integer,
	"max_alerts" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" bigserial NOT NULL,
	"channel_id" uuid NOT NULL,
	"server_id" varchar(36),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"original_message_id" bigint,
	"import_id" bigint,
	"import_channel_id" uuid,
	CONSTRAINT "messages_channel_id_id_pk" PRIMARY KEY("channel_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_messages" (
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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_content" (
	"channel_id" uuid NOT NULL,
	"message_id" bigint NOT NULL,
	"meta_data_id" integer NOT NULL,
	"content_type" integer NOT NULL,
	"content" text,
	"data_type" varchar(50),
	"is_encrypted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "message_content_channel_id_message_id_meta_data_id_content_type_pk" PRIMARY KEY("channel_id","message_id","meta_data_id","content_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_custom_metadata" (
	"channel_id" uuid NOT NULL,
	"message_id" bigint NOT NULL,
	"meta_data_id" integer NOT NULL,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "message_custom_metadata_channel_id_message_id_meta_data_id_pk" PRIMARY KEY("channel_id","message_id","meta_data_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_attachments" (
	"id" varchar(255) NOT NULL,
	"channel_id" uuid NOT NULL,
	"message_id" bigint NOT NULL,
	"mime_type" varchar(100),
	"segment_id" integer DEFAULT 0 NOT NULL,
	"attachment_size" integer NOT NULL,
	"content" text NOT NULL,
	"is_encrypted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "message_attachments_channel_id_id_segment_id_pk" PRIMARY KEY("channel_id","id","segment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_statistics" (
	"channel_id" uuid NOT NULL,
	"meta_data_id" integer,
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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "global_scripts" (
	"script_type" varchar(30) PRIMARY KEY NOT NULL,
	"script" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "configuration" (
	"category" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"value" text,
	CONSTRAINT "configuration_category_name_pk" PRIMARY KEY("category","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "global_map_entries" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '',
	"mime_type" varchar(100),
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"level" varchar(20) NOT NULL,
	"name" text NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"user_id" uuid,
	"ip_address" varchar(45),
	"channel_id" uuid,
	"server_id" varchar(36),
	"attributes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text,
	"type" varchar(20) DEFAULT 'string' NOT NULL,
	"description" text,
	"category" varchar(100) DEFAULT 'general',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_user_id_users_id_fk";
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" DROP CONSTRAINT IF EXISTS "user_permissions_user_id_users_id_fk";
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" DROP CONSTRAINT IF EXISTS "user_preferences_user_id_users_id_fk";
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connectors" DROP CONSTRAINT IF EXISTS "channel_connectors_channel_id_channels_id_fk";
ALTER TABLE "channel_connectors" ADD CONSTRAINT "channel_connectors_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_filters" DROP CONSTRAINT IF EXISTS "channel_filters_channel_id_channels_id_fk";
ALTER TABLE "channel_filters" ADD CONSTRAINT "channel_filters_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_filters" DROP CONSTRAINT IF EXISTS "channel_filters_connector_id_channel_connectors_id_fk";
ALTER TABLE "channel_filters" ADD CONSTRAINT "channel_filters_connector_id_channel_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."channel_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_rules" DROP CONSTRAINT IF EXISTS "filter_rules_filter_id_channel_filters_id_fk";
ALTER TABLE "filter_rules" ADD CONSTRAINT "filter_rules_filter_id_channel_filters_id_fk" FOREIGN KEY ("filter_id") REFERENCES "public"."channel_filters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_transformers" DROP CONSTRAINT IF EXISTS "channel_transformers_channel_id_channels_id_fk";
ALTER TABLE "channel_transformers" ADD CONSTRAINT "channel_transformers_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_transformers" DROP CONSTRAINT IF EXISTS "channel_transformers_connector_id_channel_connectors_id_fk";
ALTER TABLE "channel_transformers" ADD CONSTRAINT "channel_transformers_connector_id_channel_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."channel_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformer_steps" DROP CONSTRAINT IF EXISTS "transformer_steps_transformer_id_channel_transformers_id_fk";
ALTER TABLE "transformer_steps" ADD CONSTRAINT "transformer_steps_transformer_id_channel_transformers_id_fk" FOREIGN KEY ("transformer_id") REFERENCES "public"."channel_transformers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_scripts" DROP CONSTRAINT IF EXISTS "channel_scripts_channel_id_channels_id_fk";
ALTER TABLE "channel_scripts" ADD CONSTRAINT "channel_scripts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_metadata_columns" DROP CONSTRAINT IF EXISTS "channel_metadata_columns_channel_id_channels_id_fk";
ALTER TABLE "channel_metadata_columns" ADD CONSTRAINT "channel_metadata_columns_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_dependencies" DROP CONSTRAINT IF EXISTS "channel_dependencies_channel_id_channels_id_fk";
ALTER TABLE "channel_dependencies" ADD CONSTRAINT "channel_dependencies_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_dependencies" DROP CONSTRAINT IF EXISTS "channel_dependencies_depends_on_channel_id_channels_id_fk";
ALTER TABLE "channel_dependencies" ADD CONSTRAINT "channel_dependencies_depends_on_channel_id_channels_id_fk" FOREIGN KEY ("depends_on_channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_group_members" DROP CONSTRAINT IF EXISTS "channel_group_members_channel_group_id_channel_groups_id_fk";
ALTER TABLE "channel_group_members" ADD CONSTRAINT "channel_group_members_channel_group_id_channel_groups_id_fk" FOREIGN KEY ("channel_group_id") REFERENCES "public"."channel_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_group_members" DROP CONSTRAINT IF EXISTS "channel_group_members_channel_id_channels_id_fk";
ALTER TABLE "channel_group_members" ADD CONSTRAINT "channel_group_members_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_tag_assignments" DROP CONSTRAINT IF EXISTS "channel_tag_assignments_channel_id_channels_id_fk";
ALTER TABLE "channel_tag_assignments" ADD CONSTRAINT "channel_tag_assignments_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_tag_assignments" DROP CONSTRAINT IF EXISTS "channel_tag_assignments_tag_id_channel_tags_id_fk";
ALTER TABLE "channel_tag_assignments" ADD CONSTRAINT "channel_tag_assignments_tag_id_channel_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."channel_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_templates" DROP CONSTRAINT IF EXISTS "code_templates_library_id_code_template_libraries_id_fk";
ALTER TABLE "code_templates" ADD CONSTRAINT "code_templates_library_id_code_template_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."code_template_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_actions" DROP CONSTRAINT IF EXISTS "alert_actions_alert_id_alerts_id_fk";
ALTER TABLE "alert_actions" ADD CONSTRAINT "alert_actions_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_channels" DROP CONSTRAINT IF EXISTS "alert_channels_alert_id_alerts_id_fk";
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_channels" DROP CONSTRAINT IF EXISTS "alert_channels_channel_id_channels_id_fk";
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_user_id_users_id_fk";
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_enabled_idx" ON "users" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_permissions_user_idx" ON "user_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_connectors_channel_meta" ON "channel_connectors" USING btree ("channel_id","meta_data_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "filter_rules_filter_seq" ON "filter_rules" USING btree ("filter_id","sequence_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transformer_steps_trans_seq" ON "transformer_steps" USING btree ("transformer_id","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_scripts_channel_type" ON "channel_scripts" USING btree ("channel_id","script_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_metadata_cols_channel_name" ON "channel_metadata_columns" USING btree ("channel_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_received_idx" ON "messages" USING btree ("channel_id","received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_processed_idx" ON "messages" USING btree ("channel_id","processed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_messages_status_idx" ON "connector_messages" USING btree ("channel_id","meta_data_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_messages_queued_idx" ON "connector_messages" USING btree ("channel_id","meta_data_id","status") WHERE status = 'QUEUED';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_custom_metadata_gin" ON "message_custom_metadata" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_attachments_message_idx" ON "message_attachments" USING btree ("channel_id","message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_created_at_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_level_idx" ON "events" USING btree ("level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_channel_id_idx" ON "events" USING btree ("channel_id");