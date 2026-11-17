CREATE INDEX "audit_log_grant_idx" ON "audit_log" USING btree ("occurred_at","id") WHERE "audit_log"."action" IN ('GRANT_BASELINE', 'ASSIGNMENTS_CHANGED', 'CHANNEL_GROUPS_CHANGED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED', 'USER_ENABLED_CHANGED');--> statement-breakpoint
-- ===========================================================================
-- The grant baseline: where "who could access a channel as of a date" starts
-- ===========================================================================
-- One GRANT_BASELINE row holding every role (with its permissions and admin
-- flag), every assignment (role, scope, end time), every channel's groups and
-- every disabled user. The replay (packages/server/src/lib/grant-replay.ts)
-- starts from the latest baseline at or before the date asked and applies the
-- grant rows after it, in id order. Written here, so an existing install's
-- history starts now; by the seed after it writes grants directly; and by the
-- server once a month (partition-manager.service.ts), so every month the
-- retention keeps has a baseline to start from. SECURITY INVOKER: it reads and
-- writes only what its caller may.
--
-- The SHARE locks wait for grant changes in flight to commit and hold off new
-- ones until this transaction ends, so the snapshot holds every grant row with
-- a smaller id and none with a larger one. A short lock_timeout makes the
-- baseline, never a person's grant change, the one that gives up when the two
-- would wait on each other; the monthly caller tries again the next day.
CREATE OR REPLACE FUNCTION public.record_grant_baseline(p_reason text)
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, pg_temp
SET TimeZone = 'UTC'
SET lock_timeout = '500ms'
AS $$
  LOCK TABLE public.roles, public.role_permissions, public.assignments, public.assignment_groups,
    public.channel_group_members, public.users IN SHARE MODE;
  INSERT INTO public.audit_log (action, outcome, attributes)
  SELECT 'GRANT_BASELINE', 'SUCCESS', jsonb_build_object(
    'reason', p_reason,
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'admin', r.admin,
        'permissions', COALESCE((SELECT jsonb_agg(rp.permission ORDER BY rp.permission) FROM public.role_permissions rp WHERE rp.role_id = r.id), '[]'::jsonb)
      ) ORDER BY r.name) FROM public.roles r), '[]'::jsonb),
    'assignments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId', a.user_id, 'roleId', a.role_id,
        'expiresAt', to_char(a.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'groupIds', CASE WHEN a.all_channels THEN NULL ELSE COALESCE((
          SELECT jsonb_agg(ag.channel_group_id ORDER BY ag.channel_group_id) FROM public.assignment_groups ag WHERE ag.assignment_id = a.id), '[]'::jsonb) END
      ) ORDER BY a.user_id, a.created_at, a.id) FROM public.assignments a), '[]'::jsonb),
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('channelId', m.channel_id, 'groupIds', m.group_ids) ORDER BY m.channel_id)
      FROM (SELECT channel_id, jsonb_agg(channel_group_id ORDER BY channel_group_id) AS group_ids FROM public.channel_group_members GROUP BY channel_id) m), '[]'::jsonb),
    'disabledUserIds', COALESCE((SELECT jsonb_agg(u.id ORDER BY u.id) FROM public.users u WHERE NOT u.enabled), '[]'::jsonb)
  );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_grant_baseline(text) FROM PUBLIC;--> statement-breakpoint
SELECT public.record_grant_baseline('migration 0022');
