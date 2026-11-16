-- Database objects the server needs to run as its own role (#232, D-307).
--
-- The two functions below are SECURITY DEFINER: they run as their owner, the
-- role that runs migrations and owns the tables. Rules for both: typed
-- arguments, names quoted with format(%I/%L) and schema-qualified, search_path
-- pinned so nothing a caller puts on its path is used, and PUBLIC may not call
-- them. The server image's entrypoint grants EXECUTE to the server's role
-- (packages/server/src/db/runtime-role.ts).
--
-- ===========================================================================
-- Create a channel's message partitions through an owner function
-- ===========================================================================
-- Postgres lets only the owner of a partitioned table add a partition to it.
-- The server runs as a role that owns no application tables, so it cannot run
-- CREATE TABLE ... PARTITION OF itself. This function does only that: add the
-- six per-channel partitions for a channel that exists (both callers commit the
-- channel row first).
CREATE OR REPLACE FUNCTION public.create_channel_partitions(p_channel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  parent text;
  suffix text := replace(p_channel_id::text, '-', '_');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'channel % does not exist', p_channel_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  FOREACH parent IN ARRAY ARRAY[
    'messages', 'connector_messages', 'message_content',
    'message_statistics', 'message_attachments', 'message_custom_metadata'
  ] LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I FOR VALUES IN (%L)',
      parent || '_p_' || suffix, parent, p_channel_id
    );
  END LOOP;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_channel_partitions(uuid) FROM PUBLIC;--> statement-breakpoint
-- ===========================================================================
-- Purge old audit events through an owner function
-- ===========================================================================
-- The server's role may add and read events but not delete them, so a stolen
-- connection cannot erase the audit trail row by row or erase recent events.
-- Purge Old Events (EventService.purge) calls this instead: it deletes only
-- events at least one day old, the same minimum the API enforces, and returns
-- how many it deleted.
CREATE OR REPLACE FUNCTION public.purge_events(p_older_than_days integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  deleted bigint;
BEGIN
  IF p_older_than_days IS NULL OR p_older_than_days < 1 THEN
    RAISE EXCEPTION 'older_than_days must be at least 1, got %', p_older_than_days
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM public.events WHERE created_at <= now() - p_older_than_days * interval '1 day';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.purge_events(integer) FROM PUBLIC;--> statement-breakpoint
-- ===========================================================================
-- The job queue's schema exists before the server starts
-- ===========================================================================
-- pg-boss (lib/queue.ts) used to create its schema itself, which needs CREATE on
-- the database. The server's role does not get that: the migration creates the
-- schema, the server image's entrypoint hands it to the server's role, and
-- pg-boss runs with createSchema: false and creates its tables inside it.
CREATE SCHEMA IF NOT EXISTS pgboss;
