-- ===========================================================================
-- Create a channel's message partitions through an owner function (D-307)
-- ===========================================================================
-- Postgres lets only the owner of a partitioned table add a partition to it.
-- The server runs as a role that owns no tables (#232), so it cannot run
-- CREATE TABLE ... PARTITION OF itself. This function runs as its owner, the
-- role that runs migrations and owns the message tables, and can do only one
-- thing: add the six per-channel partitions for one channel id.
--
-- SECURITY DEFINER rules: the argument is a uuid, the names are quoted with
-- format(%I/%L) and schema-qualified, and search_path is pinned so nothing a
-- caller puts on its path is used. PUBLIC may not call it; the runtime role is
-- granted EXECUTE by the server image's entrypoint (packages/server/src/db/runtime-role.ts).
CREATE OR REPLACE FUNCTION public.create_channel_partitions(channel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  parent text;
  suffix text := replace(channel_id::text, '-', '_');
BEGIN
  IF channel_id IS NULL THEN
    RAISE EXCEPTION 'channel_id is required';
  END IF;
  FOREACH parent IN ARRAY ARRAY[
    'messages', 'connector_messages', 'message_content',
    'message_statistics', 'message_attachments', 'message_custom_metadata'
  ] LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I FOR VALUES IN (%L)',
      parent || '_p_' || suffix, parent, channel_id
    );
  END LOOP;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_channel_partitions(uuid) FROM PUBLIC;
