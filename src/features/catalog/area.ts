/**
 * The catalog's database screen, one download of its own on the web
 * (`area-loader.web.ts`), fetched the first time the catalog is opened.
 *
 * Importing expo-sqlite on the web starts its database worker and fetches its
 * engine (wa-sqlite, about 640 KB) at once (Expo SDK 58). So nothing in the
 * first download may import this module, `CatalogDatabaseScreen`,
 * `use-catalog.ts` or the `@/features/catalog` index (it re-exports
 * `use-catalog.ts`); `catalog-first-download.test.ts` keeps it that way.
 */
export { CatalogDatabaseScreen } from "./CatalogDatabaseScreen";
