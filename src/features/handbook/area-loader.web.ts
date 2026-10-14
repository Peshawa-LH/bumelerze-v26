/** Web: `area.ts` is its own download, fetched on first use (see that
 * module's comment). */
export function loadHandbookArea(): Promise<typeof import("./area")> {
  return import("./area");
}
