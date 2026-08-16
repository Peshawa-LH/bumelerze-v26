-- 0013: pg_cron scheduling for the D26 auto-assignment + crowd-detection
-- pipeline (0011's assign_unassigned_felt_reports, 0012's
-- detect_possible_events / expire_stale_possible_events). All three are
-- in-DB functions — no pg_net call, no Vault secret — so pg_cron alone is
-- enough for this wave.
--
-- Deliberately NOT scheduled here: the felt_cells aggregation Edge Function
-- (event-pipeline/felt-aggregation recompute). Invoking an Edge Function
-- from SQL needs pg_net + a Vault-stored service-role key, which is a
-- separate, slightly heavier wiring step than "schedule an in-DB function"
-- — a known, tracked follow-up, not an oversight. Until that lands, the
-- app's felt map (felt_cells_public) only refreshes when the orchestrator
-- invokes the aggregation function by hand.
--
-- Supabase project tiers vary in whether `CREATE EXTENSION pg_cron` is
-- permitted for the migration-runner role — some require enabling it first
-- via Dashboard > Database > Extensions. The whole block below is wrapped
-- in a DO block that degrades to a NOTICE instead of aborting this
-- migration if that's the case here, so a pg_cron-unavailable project still
-- gets every OTHER migration in this repo applied cleanly. The orchestrator
-- MUST verify live (`select jobname, schedule, active from cron.job;`) and,
-- if the NOTICE fired, enable pg_cron via the dashboard and re-run the three
-- `cron.schedule(...)` calls below by hand (each is independently
-- idempotent — pg_cron upserts a job by name, so re-running any of them is
-- safe).
--
-- Job-owner note: pg_cron runs each scheduled job as the role that called
-- `cron.schedule(...)` (in Supabase's default setup, the migration-runner
-- role, effectively `postgres`) — a role privileged enough to bypass the
-- `revoke ... from public, anon, authenticated` on all three target
-- functions (0011/0012). If a project's pg_cron is ever configured to run
-- jobs as a lower-privileged role, that role would additionally need an
-- explicit `grant execute` on these three functions — flagged for the
-- orchestrator to check live, not assumed here.
do $$
begin
  create extension if not exists pg_cron;

  perform cron.schedule(
    'assign_unassigned_felt_reports',
    '*/2 * * * *',
    $cron$select public.assign_unassigned_felt_reports();$cron$
  );
  perform cron.schedule(
    'detect_possible_events',
    '*/2 * * * *',
    $cron$select public.detect_possible_events();$cron$
  );
  perform cron.schedule(
    'expire_stale_possible_events',
    '0 * * * *',
    $cron$select public.expire_stale_possible_events();$cron$
  );
exception
  when others then
    raise notice 'pg_cron scheduling skipped (%): enable pg_cron via Supabase Dashboard > Database > Extensions, then run the three cron.schedule(...) calls in migration 0013''s source by hand. All other 0013 changes (none — this migration is scheduling-only) are unaffected.', sqlerrm;
end;
$$;
