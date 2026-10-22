# Bumelerze backend (Supabase)

The backend is one live Supabase project (`bcgyxepgruwardhozvfq`): Postgres
with row-level security, auth (anonymous sessions and optional accounts),
Storage, `pg_cron` and four edge functions. Migrations **0001 to 0069** are
applied, except **0041**, which is parked and not applied. The files in this
folder are the record of what is live.

## Where to read

| Path                                                                                   | What it is                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`migrations/README.md`](migrations/README.md)                                         | How migrations are written, tested and applied, and why the CLI tracker stops at 0033 |
| `migrations/__tests__/`                                                                | Static checks for every migration and PGlite runs of the migration chain              |
| [`functions/ingest-events/README.md`](functions/ingest-events/README.md)               | Feed ingestion (USGS, EMSC, GEOFON, ISC) into `events`                                |
| [`functions/aggregate-felt-cells/README.md`](functions/aggregate-felt-cells/README.md) | Felt reports into area-level intensity cells                                          |
| [`functions/send-alerts/README.md`](functions/send-alerts/README.md)                   | Earthquake alert delivery (web push, Expo push)                                       |
| `functions/purge-home-photos/index.ts`                                                 | Removes the photo files of deleted homes (header comment)                             |

**Never run `supabase db push` or `supabase migration up` against the live
project.** The CLI's migration tracker ends at 0033 on purpose; it would try to
re-apply 0034 onwards. `migrations/README.md` explains how to repair the
tracker if the CLI is ever adopted again.

## How the app connects

- `src/lib/supabase.ts` creates the client only when `EXPO_PUBLIC_SUPABASE_URL`
  and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set (`.env.example`; the production
  web build sets them in `scripts/build-app-web.sh`). Without them the app
  runs local-only: felt reports, check-ins and feedback stay queued on the
  device.
- Writes use an anonymous session unless the person has an account, so no
  sign-up is needed for felt reports.
- Each feature talks to the database through its own transport
  (`src/features/<name>/transport.ts` or `supabase-transport.ts`), with
  hand-written row types and zod validation at that boundary. There are no
  generated database types.
- The publishable (anon) key is public by design: every RLS policy assumes
  it. The service-role key is used only by edge functions and the engine's
  worker, never by the app.

## What the schema covers

| Area                                         | Main migrations                                              |
| -------------------------------------------- | ------------------------------------------------------------ |
| Events, sources, merges, ids                 | 0002, 0008, 0011, 0023, 0025, 0026, 0029, 0032               |
| Felt reports, photos, comments, cells        | 0003, 0004, 0009, 0015, 0016, 0018, 0039, 0064               |
| Crowd detection (possible events)            | 0012, 0013, 0014, 0034                                       |
| Scheduled jobs (`pg_cron`)                   | 0013, 0017, 0024, 0034, 0052, 0053, 0057, 0061 to 0063, 0067 |
| SHAKEmap product index                       | 0006, 0007, 0019, 0027, 0028, 0030, 0031                     |
| Feedback                                     | 0020, 0021, 0022, 0048                                       |
| Accounts, profiles, follows, posts, mentions | 0035, 0040, 0045, 0047, 0050, 0058, 0063, 0065               |
| Event hubs and moderation                    | 0036, 0038, 0043, 0044, 0052 to 0054, 0056, 0059, 0065       |
| Tag my building, homes and family            | 0037, 0042, 0049, 0061                                       |
| I'm safe                                     | 0057, 0064                                                   |
| Admin tools, roles, Government official      | 0046, 0051, 0055, 0060, 0061, 0066, 0069                     |
| Alerts (testers mode) and telemetry          | 0005, 0062, 0068                                             |
| Security and operations                      | 0001, 0010, 0033, 0067, 0070                                 |

Each migration's header says what it changes and why.

## `bumelerze_id`

Postgres is the only allocator of Bumelerze event ids (`bml…`), through
`allocate_bumelerze_id` and `allocate_bumelerze_id_batch` (0025, service role
only). `upsert_event_from_client`, which both the app and `ingest-events` call,
gives every new agency event an id (0026). Counters 1 to 999 of 2026 are
reserved for ids the engine's worker issued before 0025; crowd-detected
(possible) events get no id of their own.
