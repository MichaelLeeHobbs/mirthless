CREATE TABLE "assignment_groups" (
	"assignment_id" uuid NOT NULL,
	"channel_group_id" uuid NOT NULL,
	CONSTRAINT "assignment_groups_assignment_id_channel_group_id_pk" PRIMARY KEY("assignment_id","channel_group_id")
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "all_channels" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_groups" ADD CONSTRAINT "assignment_groups_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_groups" ADD CONSTRAINT "assignment_groups_channel_group_id_channel_groups_id_fk" FOREIGN KEY ("channel_group_id") REFERENCES "public"."channel_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_groups_group_idx" ON "assignment_groups" USING btree ("channel_group_id");