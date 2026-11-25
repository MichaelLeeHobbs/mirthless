ALTER TABLE "channels" ADD COLUMN "next_meta_data_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "old_numbers" jsonb;--> statement-breakpoint
ALTER TABLE "channel_connectors" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Destinations keep the numbers they have, and are listed in their order until a save changes it.
UPDATE "channel_connectors" SET "position" = "meta_data_id";--> statement-breakpoint
-- A server of the version before, still running, cannot save a channel and renumber it.
ALTER TABLE "channel_connectors" ALTER COLUMN "position" DROP DEFAULT;--> statement-breakpoint
-- The rows there now read false, without being written; those to come are true.
ALTER TABLE "connector_messages" ADD COLUMN "number_kept" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connector_messages" ALTER COLUMN "number_kept" SET DEFAULT true;--> statement-breakpoint
-- In the order a queue is read, so that messages it has to skip do not make it read the others.
DROP INDEX "connector_messages_queued_idx";--> statement-breakpoint
CREATE INDEX "connector_messages_queued_idx" ON "connector_messages" USING btree ("channel_id","meta_data_id","message_id") WHERE status = 'QUEUED';--> statement-breakpoint
-- The next number is past each one the channel has used: on a destination, a stored message, its
-- statistics or its recorded deployment.
UPDATE "channels" AS c SET
  "next_meta_data_id" = LEAST(2147483647, 1 + GREATEST(
    COALESCE((SELECT max(cc."meta_data_id") FROM "channel_connectors" cc WHERE cc."channel_id" = c."id"), 0)::bigint,
    COALESCE((SELECT max(cm."meta_data_id") FROM "connector_messages" cm WHERE cm."channel_id" = c."id"), 0)::bigint,
    COALESCE((SELECT max(ms."meta_data_id") FROM "message_statistics" ms WHERE ms."channel_id" = c."id"), 0)::bigint,
    COALESCE((
      SELECT max((n #>> '{}')::numeric)
      FROM "channel_deployments" cd, jsonb_path_query(cd."channel", '$.destinations[*].metaDataId ? (@.type() == "number")') AS n
      WHERE cd."channel_id" = c."id"
    ), 0)::bigint
  ));--> statement-breakpoint
-- Until now a save gave a destination's number to another, so a message stored up to now needs the name
-- as well: the name that the destination with its number has in the recorded deployment, or in
-- the saved channel when there is none, unless another has it too. A channel saved after it was
-- deployed may have other destinations under those numbers. The names that still hold when it is
-- deployed are those of the destinations the save left as they were.
WITH "saved" AS (
  SELECT "channel_id", "meta_data_id"::text AS "number", "name"::text AS "name", to_jsonb("connector_type"::text) AS "type", "properties",
    count(*) OVER (PARTITION BY "channel_id", "name") = 1 AS "only"
  FROM "channel_connectors"
), "deployed" AS (
  SELECT cd."channel_id", d ->> 'metaDataId' AS "number", d ->> 'name' AS "name", d -> 'connectorType' AS "type", d -> 'properties' AS "properties",
    count(*) OVER (PARTITION BY cd."channel_id", d ->> 'name') = 1 AND count(*) OVER (PARTITION BY cd."channel_id", d ->> 'metaDataId') = 1 AS "only"
  FROM "channel_deployments" cd, jsonb_path_query(cd."channel", '$.destinations[*] ? (@.metaDataId.type() == "number" && @.name.type() == "string")') AS d
), "routed" AS (
  SELECT "channel_id", "number", "name", "only" FROM "deployed"
  UNION ALL
  SELECT s."channel_id", s."number", s."name", s."only" FROM "saved" s
  WHERE NOT EXISTS (SELECT 1 FROM "channel_deployments" cd WHERE cd."channel_id" = s."channel_id")
), "both" AS (
  SELECT d."channel_id", d."number", d."name", d."only" AND s."only" AS "only",
    (d."name", d."type", d."properties") IS NOT DISTINCT FROM (s."name", s."type", s."properties") AS "same"
  FROM "deployed" d JOIN "saved" s ON s."channel_id" = d."channel_id" AND s."number" = d."number"
)
UPDATE "channels" AS c SET "old_numbers" = jsonb_build_object(
    'names', COALESCE((SELECT jsonb_object_agg(r."number", r."name") FROM "routed" r WHERE r."channel_id" = c."id" AND r."only"), '{}'::jsonb)
  ) || CASE WHEN l."changed" THEN jsonb_build_object(
    'namesOnceDeployed', COALESCE((SELECT jsonb_object_agg(b."number", b."name") FROM "both" b WHERE b."channel_id" = c."id" AND b."only" AND b."same"), '{}'::jsonb)
  ) ELSE '{}'::jsonb END
FROM (
  SELECT x."id",
    EXISTS (SELECT 1 FROM "messages" m WHERE m."channel_id" = x."id") AS "used",
    EXISTS (SELECT 1 FROM "both" b WHERE b."channel_id" = x."id" AND NOT b."same") AS "changed"
  FROM "channels" x
) AS l
WHERE l."id" = c."id" AND (l."used" OR l."changed");
