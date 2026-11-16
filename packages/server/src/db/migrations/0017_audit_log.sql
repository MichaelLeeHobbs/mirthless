-- The protected audit log (#264, D-312). A custom migration: drizzle-kit
-- generated the table as a plain one, and this file makes it partitioned.
--
-- audit_log is insert-only. The server's role holds SELECT and INSERT only
-- (db/runtime-role.ts), so it cannot change or delete a row; the triggers below
-- refuse UPDATE, DELETE and TRUNCATE even for the owner, against the owner's
-- own mistakes. Rows are partitioned by month on occurred_at, with a DEFAULT
-- partition so an insert never fails for want of a partition (system info
-- reports any row that lands there). The server's role cannot add partitions
-- (D-307), so it calls ensure_audit_partitions() at start and daily. Only the
-- owner can drop them, through drop_expired_audit_partitions(), which keeps at
-- least six years.
--
-- Function rules, as in 0016: names quoted with format(%I/%L) and
-- schema-qualified, search_path pinned, PUBLIC may not call them.
CREATE TABLE "audit_log" (
	"id" bigserial NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" varchar(100) NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"user_id" uuid,
	"channel_id" uuid,
	"ip_address" varchar(45),
	"attributes" jsonb,
	CONSTRAINT "audit_log_id_occurred_at_pk" PRIMARY KEY("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_channel_idx" ON "audit_log" USING btree ("channel_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","occurred_at");--> statement-breakpoint
-- ===========================================================================
-- Refuse changes to audit rows, even from the owner
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.audit_log_refuse_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is insert-only: % refused', TG_OP;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_log_refuse_change() FROM PUBLIC;--> statement-breakpoint
-- A row trigger on the parent is cloned onto every partition, present and future.
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_refuse_change();--> statement-breakpoint
-- A TRUNCATE trigger fires only for the table named, so each partition gets its own too.
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_refuse_change();--> statement-breakpoint
-- ===========================================================================
-- Add one partition: create it, guard it, take back UPDATE and DELETE
-- ===========================================================================
-- Internal: called only by this migration and ensure_audit_partitions(), which
-- build the name and the bounds themselves. Default privileges grant a new
-- table to the server's role (D-307); a partition must never let it UPDATE,
-- DELETE or TRUNCATE, and Postgres checks a partition's own privileges when a
-- statement names it directly.
CREATE OR REPLACE FUNCTION public.audit_log_add_partition(p_name text, p_bounds text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  grantee text;
BEGIN
  IF to_regclass(format('public.%I', p_name)) IS NOT NULL THEN
    RETURN false;
  END IF;
  EXECUTE format('CREATE TABLE public.%I PARTITION OF public.audit_log %s', p_name, p_bounds);
  EXECUTE format(
    'CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_refuse_change()',
    p_name);
  FOR grantee IN
    SELECT DISTINCT a.grantee::regrole::text
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = format('public.%I', p_name)::regclass
       AND a.grantee <> c.relowner AND a.grantee <> 0
       AND a.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM %s', p_name, grantee);
  END LOOP;
  RETURN true;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_log_add_partition(text, text) FROM PUBLIC;--> statement-breakpoint
-- The month partition's name: audit_log_y2026m11 holds November 2026, UTC.
CREATE OR REPLACE FUNCTION public.audit_log_month_partition(p_month date)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  first_day date := date_trunc('month', p_month)::date;
BEGIN
  RETURN public.audit_log_add_partition(
    'audit_log_y' || to_char(first_day, 'YYYY') || 'm' || to_char(first_day, 'MM'),
    format('FOR VALUES FROM (%L) TO (%L)',
      first_day::timestamp AT TIME ZONE 'UTC',
      (first_day + interval '1 month')::timestamp AT TIME ZONE 'UTC'));
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_log_month_partition(date) FROM PUBLIC;--> statement-breakpoint
-- ===========================================================================
-- Keep partitions ahead: the current month through three months on
-- ===========================================================================
-- The server's role calls this at start and daily. It takes no argument, so a
-- caller cannot make partitions for dates of its choosing. Returns how many it
-- created.
CREATE OR REPLACE FUNCTION public.ensure_audit_partitions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  this_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  made integer := 0;
  i integer;
BEGIN
  FOR i IN 0..3 LOOP
    IF public.audit_log_month_partition((this_month + make_interval(months => i))::date) THEN
      made := made + 1;
    END IF;
  END LOOP;
  RETURN made;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ensure_audit_partitions() FROM PUBLIC;--> statement-breakpoint
-- ===========================================================================
-- Drop months past retention: the owner's action, recorded first
-- ===========================================================================
-- Not granted to the server's role: an admin runs it as the owner
-- (docs/ops/audit-log.md). Retention is the audit.retention_years setting,
-- never less than six years. Drops only month partitions that ended before
-- the cutoff, never DEFAULT, and writes an audit row naming them first.
CREATE OR REPLACE FUNCTION public.drop_expired_audit_partitions(p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  setting text := (SELECT value FROM public.system_settings WHERE key = 'audit.retention_years');
  years integer := greatest(6, CASE WHEN setting ~ '^\d{1,3}$' THEN setting::integer ELSE 6 END);
  cutoff timestamptz := now() - make_interval(years => years);
  expired text[];
  part text;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT coalesce(array_agg(c.relname ORDER BY c.relname), '{}') INTO expired
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
   WHERE i.inhparent = 'public.audit_log'::regclass
     AND c.relname ~ '^audit_log_y\d{4}m\d{2}$'
     AND (to_date(substring(c.relname from 12 for 4) || substring(c.relname from 17 for 2), 'YYYYMM')
          + interval '1 month')::timestamp AT TIME ZONE 'UTC' <= cutoff;
  IF cardinality(expired) = 0 THEN
    RETURN 0;
  END IF;
  INSERT INTO public.audit_log (action, outcome, attributes)
  VALUES ('AUDIT_PARTITIONS_DROPPED', 'SUCCESS', jsonb_build_object(
    'partitions', to_jsonb(expired), 'retentionYears', years,
    'reason', p_reason, 'databaseUser', session_user::text));
  FOREACH part IN ARRAY expired LOOP
    EXECUTE format('DROP TABLE public.%I', part);
  END LOOP;
  RETURN cardinality(expired);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.drop_expired_audit_partitions(text) FROM PUBLIC;--> statement-breakpoint
-- ===========================================================================
-- DEFAULT and the first twelve months
-- ===========================================================================
SELECT public.audit_log_add_partition('audit_log_default', 'DEFAULT');--> statement-breakpoint
SELECT public.audit_log_month_partition((date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => m))::date)
  FROM generate_series(0, 11) AS m;
