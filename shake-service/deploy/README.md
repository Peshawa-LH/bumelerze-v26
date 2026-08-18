# deploy/ — files that belong somewhere else

Everything in this directory is a STAGING copy of a file meant to be
deployed INTO a different, separate repository. It is committed here only
because that is the repo this task's agent could write to. Nothing in this
directory runs from `bumelerze-v26` itself.

## `atlas-shake-worker.yml`

Destination: `.github/workflows/shake-worker.yml` inside the SEPARATE,
public `Peshawa-LH/bumelerze-atlas` repository (the Bumelerze Atlas —
`shake-service/OPERATIONS.md` §8's "Bumelerze Atlas data repository",
served at `https://peshawa-lh.github.io/bumelerze-atlas/`), not into this
app repository's own `.github/workflows/`.

**Deployment step (the orchestrator does this, not this repo's CI):**

```bash
cp shake-service/deploy/atlas-shake-worker.yml \
   /path/to/a/local/clone/of/bumelerze-atlas/.github/workflows/shake-worker.yml
cd /path/to/a/local/clone/of/bumelerze-atlas
git add .github/workflows/shake-worker.yml
git commit -m "ci: scheduled shake-service worker sweep"
git push origin main
```

**Why it has to live there, not here:** every GitHub repository's Actions
runs receive an automatic `GITHUB_TOKEN` scoped to write to THAT repository
only. This workflow's whole job is to publish computed ShakeMap products
into the Atlas repo's own `events/`/`index.json` tree — running it FROM
that repo means the built-in token already is the right credential, with
zero extra secrets to create, rotate, or accidentally leak. Running it from
the app repo instead would need a separate cross-repository push token (a
personal access token with write access to a repo other than the one the
workflow runs in) purely to hand-carry products across — an awkward secret
for a solo-dev operation to create and keep alive for no real benefit,
since the app repo is never the publish target either way.

**Secrets to create on the `bumelerze-atlas` repository** (Settings →
Secrets and variables → Actions → Secrets), not on `bumelerze-v26`:

| Secret | Required | Scope needed | What it's for |
|---|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL (same value as the app's `EXPO_PUBLIC_SUPABASE_URL`) | Resolves/registers the internal `events.event_id` and upserts `shakemap_products` index rows |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase **service_role** key (never anon — bypasses RLS by design, matches every other server-side writer in this project) | Same as above; the writes this worker makes have no client-facing RLS policy at all |
| `VS30_RASTER_URL` | no (optional) | Any HTTPS URL `curl` can fetch anonymously or with an embedded token (e.g. a private release asset, an S3/R2 pre-signed or bucket-policy URL) — read-only, ~610 MB payload | Lets the scheduled lane compute with the REAL Vs30 site-amplification raster instead of the honest rock-760 fallback; see OPERATIONS.md's "Scheduled lane → Vs30" section |

No `BUMELERZE_ATLAS_PUSH_TOKEN` or any other cross-repo credential is
needed — the workflow's own `permissions: contents: write` plus
`actions/checkout`'s default `persist-credentials: true` is the entire
publish credential.

Nothing else needs configuring: `scripts/run_worker.py --once
--require-supabase` fails the run with a clear message if either Supabase
secret is missing (defense in depth — the workflow's own first step checks
the same thing before even checking out any code), and every other
environment variable the pipeline reads has a safe, documented default
(`shake-service/.env.example`).

See `shake-service/OPERATIONS.md`'s "Scheduled lane" section for the full
operational writeup: what this lane does and does not cover, how it
differs from the future always-on host, and the Vs30 decision in full.
