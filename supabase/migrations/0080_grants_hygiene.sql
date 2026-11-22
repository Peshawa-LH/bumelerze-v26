-- 0080: grants hygiene and checked felt photo writes (security audit, A2.5 and
-- the server half of A2.6: DB-08, DB-10, DB-12, LIVE-14, CI-07, APP-09).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- 1. Client roles lose every table privilege that no policy uses. Every
--    table in public has row level security on, so a privilege without a
--    matching permissive policy lets nothing through today; it is a second
--    door that one future policy, or row level security switched off by
--    mistake, would open (DB-12, LIVE-14: anon could read 21 private
--    tables and write to role_permissions, home_tag_secrets,
--    shakemap_products and others). Per table and per client role (anon,
--    authenticated):
--    - TRUNCATE, REFERENCES, TRIGGER, MAINTAIN (lock, vacuum, reindex):
--      never needed by a client. Revoked on every table and view, and from
--      the defaults for future tables.
--    - INSERT, UPDATE, DELETE: revoked unless a permissive policy for that
--      command (or ALL) names the role or PUBLIC.
--    - SELECT: revoked unless a permissive policy for SELECT, UPDATE,
--      DELETE or ALL names the role (an UPDATE or DELETE with a WHERE also
--      needs SELECT), or a policy of another table that applies to the role
--      reads this one (a policy runs with the caller's privileges: guests
--      reading hub comments need SELECT on blocks, whose rows they never
--      see).
--    The rule lives in client_privilege_in_use(table, role, privilege), so
--    the check at the end and later health checks use the same test.
--    - A table without row level security would be left alone (none
--      today; the check at the end names any).
--    - Views (events_with_sources, felt_cells_public; security invoker and
--      not updatable): writes revoked, SELECT kept.
--    Column grants (the public column lists of 0077) are not touched.
--    Nothing a client can do today changes: every privilege removed here
--    was already refused by row level security.
-- 2. home_tags loses its direct UPDATE path (DB-10). The app never updates
--    the table itself (create, trash, restore and the complex link run as
--    functions), but the policy let an owner rewrite owner_user_id, code,
--    status and the place. Policy home_tags_update is dropped; rule 1 then
--    removes the privilege.
-- 3. submit_felt_photo(p_report_id, p_storage_path) writes the photo row of
--    a felt report for the report's own session only, at the one path the
--    app uses, <uid>/<report_id>.jpg (DB-08: any report id and any storage
--    path were accepted). A second call returns the row already there.
--    Errors: not_found (22023: no session, unknown report, or not yours),
--    invalid (22023: any other path). The app calls it from 26.4.9, and
--    submit_felt_report_details (0067) for the details (DB-07); the two
--    open insert policies go in 0081 once that version is live.
-- 4. strip_bidi_controls(text) removes the Unicode embedding, override and
--    isolate controls U+202A to U+202E and U+2066 to U+2069, which can make
--    a name or a comment read differently from what it is (APP-09). Kept:
--    ZWNJ and ZWJ (needed by Kurdish and Arabic shaping) and LRM and RLM
--    (single marks that cannot reverse a run of text). BEFORE INSERT and
--    UPDATE triggers named aa_strip_bidi (so they run first among the
--    BEFORE triggers and the content checks see clean text) on profiles
--    (display_name, bio, city_name), profile_posts, post_comments,
--    event_comments and felt_comments (body), home_tags (label,
--    unit_label). No stored row holds one (checked live 2026-11-22), so no
--    row is rewritten.
-- 5. pg_net (CI-07): its schema, functions and queue tables are granted to
--    PUBLIC, anon and authenticated by supabase_admin, which this role
--    cannot revoke. Accepted risk: the net schema is not exposed by the
--    API, and every caller in public is a security definer function owned
--    by postgres.
-- 6. The check at the end raises if any of this is not in place.

-- 1. Client privileges without a policy -------------------------------------------------------------
create or replace function public.client_privilege_in_use(p_table oid, p_role text, p_priv text)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select exists (
      select 1
        from pg_policy p
       where p.polrelid = p_table
         and p.polpermissive
         and (p.polroles = array[0::oid]
              or (select x.oid from pg_roles x where x.rolname = p_role) = any (p.polroles))
         and (p.polcmd = '*'
              or (p_priv = 'SELECT' and p.polcmd in ('r', 'w', 'd'))
              or (p_priv = 'INSERT' and p.polcmd = 'a')
              or (p_priv = 'UPDATE' and p.polcmd = 'w')
              or (p_priv = 'DELETE' and p.polcmd = 'd')))
    or (p_priv = 'SELECT' and exists (
      select 1
        from pg_depend d
        join pg_policy q on q.oid = d.objid
       where d.classid = 'pg_policy'::regclass
         and d.refclassid = 'pg_class'::regclass
         and d.refobjid = p_table
         and q.polrelid <> p_table
         and (q.polroles = array[0::oid]
              or (select x.oid from pg_roles x where x.rolname = p_role) = any (q.polroles))))
$$;
revoke all on function public.client_privilege_in_use(oid, text, text) from public, anon, authenticated;

revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger, maintain on tables from anon, authenticated;

drop policy if exists home_tags_update on public.home_tags;

do $$
declare
  r record;
begin
  for r in
    select c.relname, ro.rolname, pr.priv
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     cross join (values ('anon'), ('authenticated')) as ro(rolname)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as pr(priv)
     where c.relkind in ('r', 'p')
       and c.relrowsecurity
       and has_table_privilege(ro.rolname, c.oid, pr.priv)
       and not public.client_privilege_in_use(c.oid, ro.rolname, pr.priv)
     order by 1, 2, 3
  loop
    execute format('revoke %s on table public.%I from %I', r.priv, r.relname, r.rolname);
  end loop;

  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind in ('v', 'm')
     order by 1
  loop
    execute format('revoke insert, update, delete on table public.%I from anon, authenticated', r.relname);
  end loop;
end
$$;

-- 3. The photo row of a felt report -----------------------------------------------------------------
create or replace function public.submit_felt_photo(p_report_id uuid, p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_photo uuid;
begin
  if v_uid is null or p_report_id is null or not public.owns_felt_report(p_report_id, null) then
    raise exception 'submit_felt_photo: not_found' using errcode = '22023';
  end if;
  if p_storage_path is distinct from (v_uid::text || '/' || p_report_id::text || '.jpg') then
    raise exception 'submit_felt_photo: invalid' using errcode = '22023';
  end if;
  insert into public.felt_photos (report_id, storage_path)
  values (p_report_id, p_storage_path)
  on conflict (report_id) do nothing
  returning photo_id into v_photo;
  if v_photo is null then
    select f.photo_id into v_photo from public.felt_photos f where f.report_id = p_report_id;
  end if;
  return jsonb_build_object('report_id', p_report_id, 'photo_id', v_photo);
end
$$;
revoke all on function public.submit_felt_photo(uuid, text) from public, anon;
grant execute on function public.submit_felt_photo(uuid, text) to authenticated;

-- 4. Bidi controls out of user text -----------------------------------------------------------------
create or replace function public.strip_bidi_controls(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select regexp_replace(
    p_text,
    '[' || chr(8234) || '-' || chr(8238) || chr(8294) || '-' || chr(8297) || ']',
    '',
    'g')
$$;

create or replace function public.strip_bidi_trigger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'profiles' then
    new.display_name := public.strip_bidi_controls(new.display_name);
    new.bio := public.strip_bidi_controls(new.bio);
    new.city_name := public.strip_bidi_controls(new.city_name);
  elsif tg_table_name = 'home_tags' then
    new.label := public.strip_bidi_controls(new.label);
    new.unit_label := public.strip_bidi_controls(new.unit_label);
  else
    new.body := public.strip_bidi_controls(new.body);
  end if;
  return new;
end
$$;
revoke all on function public.strip_bidi_trigger() from public, anon, authenticated;

drop trigger if exists aa_strip_bidi on public.profiles;
create trigger aa_strip_bidi before insert or update of display_name, bio, city_name on public.profiles
  for each row execute function public.strip_bidi_trigger();
drop trigger if exists aa_strip_bidi on public.home_tags;
create trigger aa_strip_bidi before insert or update of label, unit_label on public.home_tags
  for each row execute function public.strip_bidi_trigger();
drop trigger if exists aa_strip_bidi on public.profile_posts;
create trigger aa_strip_bidi before insert or update of body on public.profile_posts
  for each row execute function public.strip_bidi_trigger();
drop trigger if exists aa_strip_bidi on public.post_comments;
create trigger aa_strip_bidi before insert or update of body on public.post_comments
  for each row execute function public.strip_bidi_trigger();
drop trigger if exists aa_strip_bidi on public.event_comments;
create trigger aa_strip_bidi before insert or update of body on public.event_comments
  for each row execute function public.strip_bidi_trigger();
drop trigger if exists aa_strip_bidi on public.felt_comments;
create trigger aa_strip_bidi before insert or update of body on public.felt_comments
  for each row execute function public.strip_bidi_trigger();

-- 6. Check ------------------------------------------------------------------------------------------
do $$
declare
  v_missing text[] := array[]::text[];
  v_list text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_list
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_list is not null then
    v_missing := v_missing || ('row level security on ' || v_list);
  end if;

  select string_agg(distinct c.relname || ' ' || ro.rolname || ' ' || pr.priv, ', ') into v_list
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as ro(rolname)
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as pr(priv)
   where c.relkind in ('r', 'p')
     and has_table_privilege(ro.rolname, c.oid, pr.priv)
     and not public.client_privilege_in_use(c.oid, ro.rolname, pr.priv);
  if v_list is not null then
    v_missing := v_missing || ('privilege without policy: ' || v_list);
  end if;

  select string_agg(distinct c.relname || ' ' || ro.rolname || ' ' || pr.priv, ', ') into v_list
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as ro(rolname)
   cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as pr(priv)
   where c.relkind in ('r', 'p', 'v', 'm')
     and has_table_privilege(ro.rolname, c.oid, pr.priv);
  if v_list is not null then
    v_missing := v_missing || ('client ' || v_list);
  end if;

  select string_agg(distinct c.relname || ' ' || ro.rolname || ' ' || pr.priv, ', ') into v_list
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as ro(rolname)
   cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as pr(priv)
   where c.relkind in ('v', 'm')
     and has_table_privilege(ro.rolname, c.oid, pr.priv);
  if v_list is not null then
    v_missing := v_missing || ('view write ' || v_list);
  end if;

  if not has_table_privilege('anon', 'public.events', 'select')
     or not has_table_privilege('anon', 'public.felt_cells', 'select')
     or not has_table_privilege('anon', 'public.events_with_sources', 'select')
     or not has_table_privilege('anon', 'public.felt_cells_public', 'select')
     or not has_column_privilege('anon', 'public.profiles', 'display_name', 'select')
     or not has_column_privilege('anon', 'public.event_comments', 'body', 'select')
     or not has_table_privilege('authenticated', 'public.felt_reports', 'insert')
     or not has_table_privilege('authenticated', 'public.profiles', 'update')
     or not has_table_privilege('authenticated', 'public.home_photos', 'insert')
     or not has_table_privilege('authenticated', 'public.notification_subscriptions', 'update')
     or not has_table_privilege('anon', 'public.blocks', 'select') then
    v_missing := v_missing || 'public reads and own writes kept'::text;
  end if;

  if exists (select 1 from pg_policy where polrelid = 'public.home_tags'::regclass and polname = 'home_tags_update')
     or has_table_privilege('authenticated', 'public.home_tags', 'update')
     or has_any_column_privilege('authenticated', 'public.home_tags', 'update') then
    v_missing := v_missing || 'home_tags without client update'::text;
  end if;

  if has_function_privilege('anon', 'public.client_privilege_in_use(oid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.client_privilege_in_use(oid, text, text)', 'execute') then
    v_missing := v_missing || 'client_privilege_in_use internal'::text;
  end if;

  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.submit_felt_photo(uuid, text)')
       and p.prosecdef
       and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    v_missing := v_missing || 'submit_felt_photo'::text;
  elsif not has_function_privilege('authenticated', 'public.submit_felt_photo(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.submit_felt_photo(uuid, text)', 'execute') then
    v_missing := v_missing || 'submit_felt_photo grants'::text;
  end if;

  if public.strip_bidi_controls('a' || chr(8238) || 'b' || chr(8294) || 'c' || chr(8204) || chr(8207)) is distinct from ('abc' || chr(8204) || chr(8207)) then
    v_missing := v_missing || 'strip_bidi_controls'::text;
  end if;
  if (
    select count(*) from pg_trigger t
     where t.tgname = 'aa_strip_bidi' and not t.tgisinternal
       and t.tgrelid in ('public.profiles'::regclass, 'public.home_tags'::regclass,
                         'public.profile_posts'::regclass, 'public.post_comments'::regclass,
                         'public.event_comments'::regclass, 'public.felt_comments'::regclass)
  ) <> 6 then
    v_missing := v_missing || 'aa_strip_bidi triggers'::text;
  end if;

  if cardinality(v_missing) > 0 then
    raise exception '0080: not in place: %', array_to_string(v_missing, '; ');
  end if;
end
$$;
