-- 0015: select-own RLS for felt_reports / felt_report_details (D26 item 7 —
-- "My Data" wave). Additive-only per this repo's migration convention: a new
-- numbered file, never a hand-edit of 0003_felt_reports.sql. Like every
-- migration in this repo so far, this has never been applied against a live
-- database (PROJECT.md "Blocked on Peshawa": no Supabase project yet).
--
-- ---------------------------------------------------------------------------
-- Why this exists
-- ---------------------------------------------------------------------------
-- 0003_felt_reports.sql deliberately ships NO select policy at all on
-- `felt_reports`/`felt_report_details` ("individual raw reports are never
-- publicly displayed — only cell aggregates", felt-report-science-v1.md
-- §3.5). That is still correct for PUBLIC reads. But the My Data screen
-- (D26 item 7: "a MyShake-style personal view shows the user's own reports
-- and contributions") needs a narrower thing: a device reading back ONLY
-- the rows it submitted itself. Today RLS provides no way to do that at
-- all — this migration adds it, scoped as tightly as Postgres RLS allows.
--
-- ---------------------------------------------------------------------------
-- The predicate that was rejected, and why
-- ---------------------------------------------------------------------------
-- The obvious-looking policy is `using (device_id = <value the client
-- sends>)`. This is NOT safe and is not used here: `device_id` is a plain
-- client-generated text column (0003's own comment: "RLS cannot verify this
-- value belongs to the calling device"). Any anon-key request can claim any
-- `device_id` string in its filter — a policy keyed on it would let one
-- install read every other install's reports just by guessing/observing a
-- device_id, which is exactly the "one device reads another's reports"
-- failure this wave was told never to ship.
--
-- ---------------------------------------------------------------------------
-- The predicate used instead
-- ---------------------------------------------------------------------------
-- `felt_reports.user_id` (0003, FK to `auth.users`, nullable, "present so
-- future optional accounts... attach without a migration") is exactly the
-- unforgeable identity RLS needs: it's only ever readable back via
-- `auth.uid()` inside a request carrying a real Supabase Auth JWT. Per
-- `supabase/README.md`'s "Two different anonymous identity mechanisms" and
-- `src/lib/supabase.ts`'s own `signInAnonymously()` (already written,
-- tested, and documented as "ready... not used by anything in this wave
-- yet") — Supabase Anonymous Auth issues exactly this kind of session with
-- zero email/password/registration, matching D26 item 7's "automatically
-- registered, they don't need to register" requirement.
--
--   felt_reports_select_own:          auth.uid() = user_id
--   felt_report_details_select_own:   EXISTS a felt_reports row this
--                                      predicate already allows, joined via
--                                      felt_report_id (details has no
--                                      user_id column of its own — it is a
--                                      1:1 child of felt_reports, migration
--                                      0003).
--
-- Both are `to authenticated` only — the `anon` role never carries a JWT
-- `sub` claim, so `auth.uid()` is NULL for it and this predicate can never
-- match, but restricting the role explicitly (rather than relying on that)
-- documents the intent and matches `notification_subscriptions`'s own
-- `to authenticated`-only select policy (migration 0005).
--
-- ---------------------------------------------------------------------------
-- What this migration deliberately does NOT do
-- ---------------------------------------------------------------------------
-- It does not change what the app WRITES. `src/features/felt/
-- supabase-transport.ts` still inserts `felt_reports`/`felt_report_details`
-- with no `user_id` (device_id-only, per D8 "must not require signup" —
-- unchanged, see that file's own column-mapping doc). That means today this
-- policy is CORRECT but not yet exercised: no row has a `user_id` for it to
-- match, so a select-own query returns nothing regardless of who asks.
-- Wiring `signInAnonymously()` + populating `user_id` at insert time is
-- flagged as follow-up work, not done here — the My Data screen this
-- migration supports reads its own device's reports from the LOCAL queue
-- store instead (`src/features/felt/queue.ts`, which already durably holds
-- every report this device has ever submitted), so the screen has a
-- complete, working, privacy-safe data source with zero dependency on this
-- policy ever being exercised. This migration exists so the capability is
-- correctly in place for whenever that follow-up wave wires it up — never
-- half-built as an unsafe device_id predicate in the meantime.

create policy felt_reports_select_own
  on public.felt_reports for select
  to authenticated
  using (auth.uid() = user_id);

comment on policy felt_reports_select_own on public.felt_reports is
  'D26 item 7 (My Data): a signed-in-anonymously device may read back ONLY its own rows, matched via auth.uid() = user_id — never device_id, which is client-supplied and unverifiable by RLS (see this file''s own header comment).';

create policy felt_report_details_select_own
  on public.felt_report_details for select
  to authenticated
  using (
    exists (
      select 1
      from public.felt_reports fr
      where fr.report_id = felt_report_details.felt_report_id
        and fr.user_id = auth.uid()
    )
  );

comment on policy felt_report_details_select_own on public.felt_report_details is
  'D26 item 7 (My Data): same auth.uid()-scoped ownership as felt_reports_select_own, joined via felt_report_id since felt_report_details carries no user_id column of its own.';
