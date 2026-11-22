-- 0081: felt report details and felt photo rows only through their
-- functions (security audit DB-07, DB-08; A2.6).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice). Applied after app 26.4.9 is live: from that version the app
-- sends the details through submit_felt_report_details (0067) and the photo
-- row through submit_felt_photo (0080), both of which write only for the
-- report's own session. An older cached app that still inserts directly is
-- refused, keeps the item in its queue and sends it again after the update
-- reloads it.
--
-- 1. felt_report_details_insert (with check true: whoever knew a report id
--    could file its answers first, DB-07) and felt_photos_insert (any report,
--    any storage path, DB-08) are dropped, and INSERT on both tables is
--    revoked from the client roles.
-- 2. submit_felt_report_details is no longer callable without a session
--    (anon): ownership is the session's (0079), so a call without one could
--    only answer not_found.
-- 3. The check at the end raises if this is not in place, and also when
--    0080 has not been applied (submit_felt_photo missing): without it the
--    app would have no way to write a photo row.

drop policy if exists felt_report_details_insert on public.felt_report_details;
drop policy if exists felt_photos_insert on public.felt_photos;
revoke insert on public.felt_report_details, public.felt_photos from anon, authenticated;
revoke execute on function public.submit_felt_report_details(uuid, text, jsonb) from anon;

do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure('public.submit_felt_photo(uuid, text)') is null then
    v_missing := v_missing || 'submit_felt_photo (0080 first)'::text;
  elsif not has_function_privilege('authenticated', 'public.submit_felt_photo(uuid, text)', 'execute') then
    v_missing := v_missing || 'submit_felt_photo for authenticated'::text;
  end if;
  if not has_function_privilege('authenticated', 'public.submit_felt_report_details(uuid, text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.submit_felt_report_details(uuid, text, jsonb)', 'execute') then
    v_missing := v_missing || 'submit_felt_report_details for authenticated only'::text;
  end if;
  if exists (
    select 1 from pg_policy p
     where p.polrelid in ('public.felt_report_details'::regclass, 'public.felt_photos'::regclass)
       and p.polcmd in ('a', '*')
  ) then
    v_missing := v_missing || 'no insert policy on felt_report_details, felt_photos'::text;
  end if;
  if has_table_privilege('anon', 'public.felt_report_details', 'insert')
     or has_table_privilege('authenticated', 'public.felt_report_details', 'insert')
     or has_table_privilege('anon', 'public.felt_photos', 'insert')
     or has_table_privilege('authenticated', 'public.felt_photos', 'insert')
     or has_any_column_privilege('authenticated', 'public.felt_report_details', 'insert')
     or has_any_column_privilege('authenticated', 'public.felt_photos', 'insert') then
    v_missing := v_missing || 'no client insert on felt_report_details, felt_photos'::text;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '0081: not in place: %', array_to_string(v_missing, '; ');
  end if;
end
$$;
