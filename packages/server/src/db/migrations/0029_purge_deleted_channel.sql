-- The messages of deleted channels (#202, D-389).
--
-- ===========================================================================
-- Remove all messages of a deleted channel through an owner function
-- ===========================================================================
-- TRUNCATE needs the tables' owner, and the server's role owns none (D-307). A
-- channel can have millions of messages, and deleting them one by one takes
-- longer than a request may. This function empties the five message tables of
-- one channel that is deleted, in the caller's transaction, and nothing else,
-- and returns how many messages there were and how many of them were never
-- delivered. The rules for owner functions are in migration 0016.
--
-- The channel's partitions are locked before anything else of them is read,
-- all at once or not at all. A lock that is not free at once is given back
-- with the others, and the purge then waits for that one alone, for a little
-- longer than deadlock_timeout: an autovacuum gives way only to a lock that
-- has waited that long, which NOWAIT never does. It tries for 5 seconds, then
-- fails. So it waits only while it holds no partition of the channel, a read
-- that takes the tables in another order cannot deadlock with it, and a read
-- waits behind it for at most that second. A backup under way holds a lock on
-- every table, so a purge then fails. Nothing is read through the parent
-- tables before the locks are had, since a lock on a parent held through the
-- wait would hold up the creation of a channel and every insert behind it.
CREATE OR REPLACE FUNCTION public.purge_deleted_channel(p_channel_id uuid)
RETURNS TABLE (purged_messages bigint, purged_undelivered bigint)
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
  -- What each table is read through: the channel's partition, or the parent.
  rel text[] := '{}';
  busy regclass;
  deadline timestamptz := clock_timestamp() + interval '5 seconds';
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
      rel := rel || part::text;
    ELSE
      unpartitioned := unpartitioned || parent;
      rel := rel || format('public.%I', parent);
    END IF;
  END LOOP;
  LOOP
    BEGIN
      IF busy IS NOT NULL THEN
        PERFORM set_config('lock_timeout', '1100ms', true);
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', busy);
      END IF;
      FOREACH part IN ARRAY parts LOOP
        busy := part;
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT', part);
      END LOOP;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() > deadline THEN
        RAISE;
      END IF;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;
  -- As DeletedChannelService counts them for its list; the tests hold the two to the same numbers.
  EXECUTE format(
    'SELECT (SELECT count(*) FROM %1$s WHERE channel_id = $1),
            (SELECT count(*) FROM (
               SELECT id FROM %1$s WHERE channel_id = $1 AND NOT processed
               UNION
               SELECT cm.message_id FROM %2$s cm
               WHERE cm.channel_id = $1 AND cm.status IN (''QUEUED'', ''PENDING'')
                 AND EXISTS (SELECT 1 FROM %1$s m WHERE m.channel_id = $1 AND m.id = cm.message_id)
             ) waiting)',
    rel[1], rel[2]) INTO purged_messages, purged_undelivered USING p_channel_id;
  FOREACH part IN ARRAY parts LOOP
    EXECUTE format('TRUNCATE TABLE %s', part);
  END LOOP;
  -- A channel without partitions has its rows in the default ones. A delete
  -- takes no lock that a read waits for.
  FOREACH parent IN ARRAY unpartitioned LOOP
    EXECUTE format('DELETE FROM public.%I WHERE channel_id = $1', parent) USING p_channel_id;
  END LOOP;
  RETURN NEXT;
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
