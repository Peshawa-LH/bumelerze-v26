/** Regional Catalog browser tunables (D14: engineering-owned defaults, no
 * science review needed — same convention as `features/events/config.ts`). */

/** Rows fetched per page (`LIMIT`), both for the initial load and every
 * subsequent `onEndReached` page while scrolling. Small enough to keep
 * each query fast on low-end Android (PROJECT.md baseline device), large
 * enough that a normal scroll session rarely needs more than 2-3 pages. */
export const CATALOG_PAGE_SIZE = 40;

/** Stepper increment sizes (see `components/NumericStepper.tsx`). Magnitude
 * steps in half-units (the catalog's own values are already ~1-decimal
 * precision, so 0.5 covers the useful range in a manageable number of
 * taps); year steps in decades — a single-year step would need over 100
 * taps to cross the catalog's 872-2023 span, so the stepper supports
 * press-and-hold repeat on top of this step size for fast traversal. */
export const CATALOG_MAG_STEP = 0.5;
export const CATALOG_YEAR_STEP = 10;

/** Bundled sqlite asset name `SQLiteProvider` opens (copied into the app's
 * document directory on first launch, standard expo-sqlite bundled-asset
 * pattern).
 *
 * VERSIONED — BUMP THE `-vN` SUFFIX EVERY TIME THE BUNDLED ASSET IS
 * REGENERATED WITH A SCHEMA CHANGE: expo-sqlite copies the asset only when
 * no file with this name exists yet, so an unversioned name leaves every
 * EXISTING install querying its stale first-launch copy. That exact bug
 * shipped when the bml `bumelerze_id` column landed (2026-08-15, caught by
 * Peshawa on-device: new query, old copied db, catalog dead on upgrades
 * while fresh installs worked). v2 = the bml-id schema. v3 = the
 * `export_app_catalog.py` rebuild (2026-08-28): `bumelerze_id` became the
 * primary key (surrogate `id` column dropped), `time` became epoch-seconds
 * `t`, and `author_agency` was added — a v2-schema query against a v2 file
 * cannot serve v3 rows, so this bump is required, not cosmetic. Old copies
 * are cleaned up in app/catalog.tsx (`cleanUpLegacyDatabases`). */
/**
 * Bump this on EVERY change to the exported catalog schema, not merely
 * when the data changes. `assetSource` copies the bundled database out
 * once and then keeps the copy forever, so an install that already holds
 * an older copy under the same name never sees the new columns and every
 * query against them fails with "Couldn't load the catalog".
 *
 * v3 shipped twice by mistake on 2026-08-28: once without `region` and
 * once with it. The second shipment broke any install that had opened the
 * first, which is exactly the failure this comment exists to prevent.
 * v4 is that fix.
 */
export const CATALOG_DATABASE_NAME = "bumelerze-catalog-v4.sqlite";

/** Previous on-device copy names, deleted fire-and-forget at catalog mount
 * so stale multi-megabyte databases don't accumulate across upgrades. */
export const LEGACY_CATALOG_DATABASE_NAMES = [
  "bumelerze-catalog.sqlite",
  "bumelerze-catalog-v2.sqlite",
  "bumelerze-catalog-v3.sqlite",
] as const;
