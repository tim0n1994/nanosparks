-- DBA REVIEW REQUIRED. Not a migration and never executed by the collector.
-- PostgreSQL 16+. Run only after reviewing the target DB, load and ownership.
-- Creates new roles; intentionally fails instead of changing an existing role.
-- No password here. DBA must provision a SCRAM credential out of band.
-- Prerequisites: reader must not inherit PUBLIC CREATE/TEMP/schema CREATE or
-- SECURITY DEFINER EXECUTE. Adjusting PUBLIC affects other users: do not blindly
-- revoke in production. Regrant legitimate application needs to explicit roles
-- or use an isolated reporting DB. This template only detects that condition.
BEGIN;
CREATE ROLE nanosparks_mcp_view_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE nanosparks_mcp_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
ALTER ROLE nanosparks_mcp_reader SET default_transaction_read_only = on;
ALTER ROLE nanosparks_mcp_reader SET statement_timeout = '2s';
ALTER ROLE nanosparks_mcp_reader SET lock_timeout = '250ms';
ALTER ROLE nanosparks_mcp_reader SET idle_in_transaction_session_timeout = '3s';

DO $$
BEGIN
  IF has_database_privilege('nanosparks_mcp_reader', current_database(), 'CREATE,TEMP')
     OR EXISTS (SELECT 1 FROM pg_namespace
       WHERE has_schema_privilege('nanosparks_mcp_reader', oid, 'CREATE'))
     OR EXISTS (SELECT 1 FROM pg_proc WHERE prosecdef
       AND has_function_privilege('nanosparks_mcp_reader', oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'MCP reader inherits unsafe privileges; DBA must review PUBLIC grants first';
  END IF;
END $$;

CREATE SCHEMA nanosparks_mcp AUTHORIZATION nanosparks_mcp_view_owner;
REVOKE ALL ON SCHEMA nanosparks_mcp FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nanosparks_mcp_view_owner;
-- View owner sees only the status columns required to compute these aggregates.
GRANT SELECT (status) ON public."Conversation", public."ExtractionRun"
  TO nanosparks_mcp_view_owner;
CREATE VIEW nanosparks_mcp.business_counts WITH (security_barrier = true) AS
WITH conversations AS (
  SELECT count(*)::bigint AS conversations_total,
    count(*) FILTER (WHERE status = 'completed')::bigint AS conversations_completed,
    count(*) FILTER (WHERE status = 'failed')::bigint AS conversations_failed
  FROM public."Conversation"
), extractions AS (
  SELECT count(*)::bigint AS extractions_total,
    count(*) FILTER (WHERE status = 'completed')::bigint AS extractions_completed,
    count(*) FILTER (WHERE status = 'failed')::bigint AS extractions_failed,
    count(*) FILTER (WHERE status = 'pending')::bigint AS extractions_pending,
    count(*) FILTER (WHERE status = 'running')::bigint AS extractions_running
  FROM public."ExtractionRun"
)
SELECT conversations_total, conversations_completed, conversations_failed,
  extractions_total, extractions_completed, extractions_failed,
  extractions_pending, extractions_running
FROM conversations CROSS JOIN extractions;
ALTER VIEW nanosparks_mcp.business_counts OWNER TO nanosparks_mcp_view_owner;
REVOKE ALL ON nanosparks_mcp.business_counts FROM PUBLIC;
GRANT USAGE ON SCHEMA nanosparks_mcp TO nanosparks_mcp_reader;
GRANT SELECT ON nanosparks_mcp.business_counts TO nanosparks_mcp_reader;
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO nanosparks_mcp_reader', current_database());
END $$;
COMMIT;

-- DBA checks before issuing credentials:
-- 1. Reader has no memberships, base-table/column/sequence privileges, schema or
--    database CREATE/TEMP, or executable SECURITY DEFINER routines via PUBLIC.
-- 2. View owner is NOLOGIN, is not granted to reader, and the reviewed view has
--    exactly these eight integer columns. No joins/filters by user or small cohort.
-- 3. COUNT scans fit the 2s budget on a reporting replica. Timeouts mean UNKNOWN.
-- 4. No app DATABASE_URL, app role or initial PG account is used by this package.
