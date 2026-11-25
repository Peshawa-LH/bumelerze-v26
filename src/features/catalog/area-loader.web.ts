/** Web: `area.ts` is its own download, fetched the first time the catalog
 * is opened (see that module's comment). */
export function loadCatalogArea(): Promise<typeof import("./area")> {
  return import("./area");
}
