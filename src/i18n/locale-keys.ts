/**
 * Recursively flattens a locale catalog into a sorted list of dotted key
 * paths (e.g. "settings.languages.ckb"). Used to enforce that every locale
 * ships exactly the same keys as the English source of truth — a missing
 * key in a translated catalog silently falls back to English at runtime,
 * which is easy to miss without this check (PROJECT.md: "no hard-coded
 * strings, ever" implies no *silently missing* strings either).
 */
export function flattenKeys(
  catalog: Record<string, unknown>,
  prefix = "",
): string[] {
  const keys: string[] = [];

  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }

  return keys.sort();
}
