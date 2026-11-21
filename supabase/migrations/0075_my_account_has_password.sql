-- 0075: my_account_has_password (security checklist A0.1).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- The Password screen now asks for the current password before a change
-- (the app checks it by signing in again with it). Accounts made by the old
-- email link have no password yet and set their first one on the same
-- screen, so the app must know which case applies; auth.users cannot be
-- read from the app. This answers it for the caller alone: true when the
-- signed-in user has a password, false otherwise (also for an anonymous
-- user, and for a call without a session, where auth.uid() is null). Only
-- a yes or no about the caller's own row comes back, never the hash, and
-- only signed-in callers may ask.

create or replace function public.my_account_has_password()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select encrypted_password from auth.users where id = auth.uid()), '') <> '';
$$;

revoke all on function public.my_account_has_password() from public, anon;
grant execute on function public.my_account_has_password() to authenticated;
