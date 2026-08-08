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
 * pattern) — kept distinct from the source file's own name so a future
 * catalog rebuild with a different filename doesn't require an app-side
 * rename too. */
export const CATALOG_DATABASE_NAME = "bumelerze-catalog.sqlite";
