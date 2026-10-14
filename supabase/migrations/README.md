# Migrations

Numbered SQL files, applied in order. The repo is the record of what is live.

## How they are applied

- 0001 to 0033 went through the Supabase CLI and are listed in
  `supabase_migrations.schema_migrations`.
- 0034 onwards (except 0041, which is parked and not applied) are applied by
  hand in the dashboard's SQL editor, as one line: full-line `--` comments
  dropped, whitespace collapsed. That is why every file keeps the rules
  pinned by the `__tests__` here: full-line comments only (a `--` inside a
  string literal would be cut), plain ASCII, no `?`, no `begin`/`commit`,
  and idempotent (`if not exists`, `create or replace`, `on conflict do
nothing`), so a second run changes nothing.
- A migration is proven before it is applied: its own static test in
  `__tests__`, and a run against a real Postgres (PGlite) on a chain ending
  in the new file, applied twice, with the previous migrations' suites
  re-run on top.

## The tracker is stale on purpose

`supabase_migrations.schema_migrations` still ends at 0033. The CLI would
try to re-apply 0034 onwards, so never run `supabase db push` or
`supabase migration up` against the live project without repairing the
tracker first. If the CLI is ever adopted again, mark the applied files as
applied (skipping 0041), after `supabase link --project-ref bcgyxepgruwardhozvfq`:

```sh
for f in supabase/migrations/00[3-9][0-9]_*.sql; do
  v=$(basename "$f"); v=${v%%_*}
  [ "$v" -ge 34 ] && [ "$v" != "0041" ] && supabase migration repair --status applied "$v"
done
```

The same can be recorded with SQL in the editor (one row per file), for
example `insert into supabase_migrations.schema_migrations (version, name)
values ('0067', '0067_ops_and_hygiene') on conflict do nothing;`.
