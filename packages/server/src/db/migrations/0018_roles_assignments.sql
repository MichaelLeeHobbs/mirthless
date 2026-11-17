-- Roles, role permissions and assignments (#265 slice 6, D-310). drizzle-kit
-- generated the tables; the data at the end of this file is hand-written.
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" varchar(64) NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions" USING btree ("permission");--> statement-breakpoint
CREATE INDEX "assignments_user_idx" ON "assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assignments_role_idx" ON "assignments" USING btree ("role_id");
--> statement-breakpoint
-- Roles become rows and users get assignments (#265 slice 6, D-310). The
-- built-in roles below match db/seeds/roles.ts; role-migration.itest.ts checks
-- both that they do and that every user holds the same permissions after this
-- migration as before it. Admin is a locked row with no role_permissions:
-- the resolver gives its holders every permission. A user whose users.role
-- names no built-in role held no permissions before and gets no assignment.
INSERT INTO "roles" ("name", "description", "built_in", "admin") VALUES
	('admin', 'Every permission on every channel. Locked.', true, true),
	('deployer', 'Builds, deploys and runs channels, and manages the shared areas they use.', true, false),
	('developer', 'Builds channels and code templates; cannot deploy.', true, false),
	('viewer', 'Reads channels, messages and settings; changes nothing.', true, false),
	('channel-viewer', 'Viewer without the reads that reach every channel, for an assignment scoped to channel groups.', true, false),
	('channel-developer', 'Developer without the permissions limited to all-channel assignments, for an assignment scoped to channel groups.', true, false),
	('channel-deployer', 'Deployer without the permissions limited to all-channel assignments, for an assignment scoped to channel groups.', true, false);
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
FROM (VALUES
	('deployer', 'channels:read'), ('deployer', 'channels:write'), ('deployer', 'channels:deploy'),
	('deployer', 'messages:read'), ('deployer', 'messages:reprocess'),
	('deployer', 'code_templates:read'), ('deployer', 'code_templates:write'), ('deployer', 'code_templates:delete'),
	('deployer', 'alerts:read'), ('deployer', 'alerts:write'), ('deployer', 'alerts:delete'),
	('deployer', 'events:read'),
	('deployer', 'resources:read'), ('deployer', 'resources:write'), ('deployer', 'resources:delete'),
	('deployer', 'collections:read'), ('deployer', 'collections:write'), ('deployer', 'collections:delete'),
	('deployer', 'datasources:read'), ('deployer', 'datasources:write'), ('deployer', 'datasources:delete'),
	('deployer', 'global_scripts:read'), ('deployer', 'global_map:read'), ('deployer', 'config_map:read'),
	('deployer', 'system:info'),
	('developer', 'channels:read'), ('developer', 'channels:write'),
	('developer', 'messages:read'),
	('developer', 'code_templates:read'), ('developer', 'code_templates:write'),
	('developer', 'alerts:read'),
	('developer', 'events:read'),
	('developer', 'resources:read'), ('developer', 'resources:write'),
	('developer', 'collections:read'), ('developer', 'collections:write'),
	('developer', 'datasources:read'),
	('developer', 'global_scripts:read'), ('developer', 'global_map:read'), ('developer', 'config_map:read'),
	('viewer', 'channels:read'), ('viewer', 'messages:read'), ('viewer', 'code_templates:read'), ('viewer', 'alerts:read'),
	('viewer', 'events:read'), ('viewer', 'resources:read'), ('viewer', 'collections:read'), ('viewer', 'datasources:read'),
	('channel-viewer', 'channels:read'), ('channel-viewer', 'messages:read'), ('channel-viewer', 'code_templates:read'),
	('channel-viewer', 'alerts:read'), ('channel-viewer', 'events:read'), ('channel-viewer', 'resources:read'),
	('channel-viewer', 'datasources:read'),
	('channel-developer', 'channels:read'), ('channel-developer', 'channels:write'),
	('channel-developer', 'messages:read'),
	('channel-developer', 'code_templates:read'), ('channel-developer', 'code_templates:write'),
	('channel-developer', 'alerts:read'), ('channel-developer', 'events:read'),
	('channel-developer', 'resources:read'), ('channel-developer', 'datasources:read'),
	('channel-developer', 'global_scripts:read'),
	('channel-deployer', 'channels:read'), ('channel-deployer', 'channels:write'), ('channel-deployer', 'channels:deploy'),
	('channel-deployer', 'messages:read'), ('channel-deployer', 'messages:reprocess'),
	('channel-deployer', 'code_templates:read'), ('channel-deployer', 'code_templates:write'), ('channel-deployer', 'code_templates:delete'),
	('channel-deployer', 'alerts:read'), ('channel-deployer', 'events:read'),
	('channel-deployer', 'resources:read'), ('channel-deployer', 'datasources:read'),
	('channel-deployer', 'global_scripts:read')
) AS p("role", "permission")
JOIN "roles" r ON r."name" = p."role";
--> statement-breakpoint
INSERT INTO "assignments" ("user_id", "role_id", "reason")
SELECT u."id", r."id", 'Migrated from the user''s role'
FROM "users" u
JOIN "roles" r ON r."name" = u."role";
