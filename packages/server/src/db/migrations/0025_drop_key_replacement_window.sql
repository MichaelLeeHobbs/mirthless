-- A leaver's API keys stop with them (D-322): the 7-day replacement window is
-- gone. Keys still waiting in one, or otherwise issued by a disabled user, are
-- disabled here, and a grant baseline after it keeps the access replay true.
UPDATE "users" SET "enabled" = false, "updated_at" = now()
WHERE "kind" = 'api_key' AND "enabled" AND "id" IN (
  SELECT k."user_id" FROM "api_keys" k JOIN "users" i ON i."id" = k."issued_by"
  WHERE NOT i."enabled" AND k."revoked_at" IS NULL
);--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "replace_by";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "replace_warned_at";--> statement-breakpoint
SELECT public.record_grant_baseline('migration 0025');
