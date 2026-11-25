-- The messages of deleted channels (#202, D-389).
--
-- ===========================================================================
-- Remove all messages of a deleted channel through an owner function
-- ===========================================================================
-- TRUNCATE needs the tables' owner, and the server's role owns none (D-307). A
-- channel can have millions of messages, and deleting them one by one takes
-- longer than a request may. This function empties the five message tables of
-- one channel that is deleted, in the caller's transaction, and nothing else.
-- The rules for owner functions are in migration 0016. The tables are locked in
-- the order a read of messages takes them, and a lock that is not free (a
-- backup under way holds one on every table) fails the purge instead of
-- holding up the reads that come after it.
CREATE OR REPLACE FUNCTION public.purge_deleted_channel(p_channel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  parent text;
  part regclass;
BEGIN
  -- Locked, so that the channel is still deleted when the purge is committed.
  PERFORM 1 FROM public.channels WHERE id = p_channel_id AND deleted_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'channel % is not a deleted channel', p_channel_id USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOREACH parent IN ARRAY ARRAY[
    'messages', 'connector_messages', 'message_content', 'message_attachments', 'message_custom_metadata'
  ] LOOP
    SELECT i.inhrelid::regclass INTO part
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = format('public.%I', parent)::regclass
      AND c.relname = parent || '_p_' || replace(p_channel_id::text, '-', '_');
    IF part IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE %s', part);
    ELSE
      -- A channel without partitions has its rows in the default one.
      EXECUTE format('DELETE FROM public.%I WHERE channel_id = $1', parent) USING p_channel_id;
    END IF;
  END LOOP;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.purge_deleted_channel(uuid) FROM PUBLIC;--> statement-breakpoint
-- ===========================================================================
-- Channels that are deleted already are not pruned
-- ===========================================================================
-- The pruner left deleted channels out, so deleting one kept its messages. From
-- now on it prunes them by the settings they had. Those deleted before never
-- counted on that, and nobody can change their settings any more, so they keep
-- their messages until an administrator removes them.
UPDATE public.channels SET pruning_enabled = false WHERE deleted_at IS NOT NULL AND pruning_enabled;
