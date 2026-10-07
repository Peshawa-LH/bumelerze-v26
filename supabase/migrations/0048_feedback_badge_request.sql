-- 0048: Feedback category "Badge request" (owner note N5, 2026-10-07).
--
-- People ask for an Engineer / Researcher / Professor / Seismologist badge by
-- writing to us; the feedback form gets a "Badge request" choice. Until now
-- `feedback.category` was assigned during triage only (0022), never by the
-- client. This migration keeps that rule for every category EXCEPT the new
-- one: a client may tag its own message `badge_request`, any other value a
-- client sends is dropped to null. Triage (service role / SQL editor) can
-- still set or change any category.

do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.feedback'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%category%'
  loop
    execute format('alter table public.feedback drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.feedback
  add constraint feedback_category_check
  check (category is null or category in (
    'bug', 'improvement', 'suggestion', 'question', 'other', 'badge_request'
  ));

create or replace function public.feedback_client_category_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and new.category is distinct from 'badge_request' then
    new.category := null;
  end if;
  return new;
end
$$;
drop trigger if exists feedback_client_category_guard on public.feedback;
create trigger feedback_client_category_guard
  before insert on public.feedback
  for each row execute function public.feedback_client_category_guard();

revoke all on function public.feedback_client_category_guard() from public, anon, authenticated;
