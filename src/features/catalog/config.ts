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
 * while fresh installs worked). v2 = the bml-id schema. Old copies are
 * cleaned up in app/catalog.tsx (`deleteLegacyCatalogCopies`). */
export const CATALOG_DATABASE_NAME = "bumelerze-catalog-v2.sqlite";

/** Previous on-device copy names, deleted fire-and-forget at catalog mount
 * so stale multi-megabyte databases don't accumulate across upgrades. */
export const LEGACY_CATALOG_DATABASE_NAMES = ["bumelerze-catalog.sqlite"] as const;
