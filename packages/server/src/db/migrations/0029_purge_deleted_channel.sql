-- The messages of deleted channels (#202, D-389).
--
-- ===========================================================================
-- Remove all messages of a deleted channel through an owner function
-- ===========================================================================
-- TRUNCATE needs the tables' owner, and the server's role owns none (D-307). A
-- channel can have millions of messages, and deleting them one by one takes
-- longer than a request may. This function empties the five message tables of
-- one channel that is deleted, in the caller's transaction, and nothing else.
-- The rules for owner functions are in migration 0016.
--
-- The channel's partitions are locked all at once or not at all: a lock that is
-- not free at once is given back with the others, and the purge tries again
-- for 5 seconds, then fails. So it never waits while it holds a lock. A read
-- that takes the tables in another order cannot deadlock with it, and no read
-- queues behind it. A backup under way holds a lock on every table, so a purge
-- then fails.
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
  parts regclass[] := '{}';
  unpartitioned text[] := '{}';
  locked boolean := false;
  tries integer := 0;
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
      parts := parts || part;
    ELSE
      unpartitioned := unpartitioned || parent;
    END IF;
  END LOOP;
  WHILE NOT locked LOOP
    BEGIN
      FOREACH part IN ARRAY parts LOOP
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT', part);
      END LOOP;
      locked := true;
    EXCEPTION WHEN lock_not_available THEN
      tries := tries + 1;
      IF tries >= 50 THEN
        RAISE;
      END IF;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;
  FOREACH part IN ARRAY parts LOOP
    EXECUTE format('TRUNCATE TABLE %s', part);
  END LOOP;
  -- A channel without partitions has its rows in the default ones. A delete
  -- takes no lock that a read waits for.
  FOREACH parent IN ARRAY unpartitioned LOOP
    EXECUTE format('DELETE FROM public.%I WHERE channel_id = $1', parent) USING p_channel_id;
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
