/**
 * Types/validation/localization for the OSM-derived Kurdish place-names
 * dataset (update-plan §4.7 Part 1/2) — the fix for the owner's repeated
 * map complaint that only a handful of hand-checked gazetteer cities
 * (`gazetteer.ts`) carry a real Sorani name, with everything below that
 * (towns, villages) falling back to the basemap's Latin/Arabic labels.
 * OpenStreetMap itself carries `name:ckb` (Sorani) and `name:ku`
 * (Kurmanji) tags across Kurdistan, contributed by Kurdish mappers —
 * `scripts/build-kurdish-places.mjs` extracts, dedups, and tiers those
 * into the two bundled JSON assets this module types and validates:
 * `data/kurdish-places-core.json` (tier 1-2: city/town/suburb, small,
 * loaded unconditionally) and `data/kurdish-places-villages.json` (tier 3:
 * village/hamlet, the bulk of the dataset — loaded lazily by
 * `map.web.tsx`, mirroring how it already lazy-loads `maplibre-gl` itself,
 * so a session that never opens the Map tab never pays for it).
 *
 * LICENSING: this dataset is a derived extract of OpenStreetMap data
 * (Open Database License, ODbL) — see `DATA-SOURCES.md` §4 for the
 * attribution this module's consumers must keep showing on-screen, and
 * `own-labels.ts`'s `OWN_LABELS_ATTRIBUTION` for where that attribution is
 * actually wired into the map.
 */
import { z } from "zod";

/** Render tier `scripts/build-kurdish-places.mjs` assigns from the OSM
 * `place` tag: 1 = city, 2 = town/suburb, 3 = village/hamlet. This module
 * only ever sees the already-tiered dataset, not the original `place` tag
 * the tier was computed from. */
export type KurdishPlaceTier = 1 | 2 | 3;

const kurdishPlaceNamesSchema = z
  .object({
    ckb: z.string().min(1).optional(),
    kmr: z.string().min(1).optional(),
    ar: z.string().min(1).optional(),
  })
  // Every shipped record carries at least one name (the build script drops
  // anything that doesn't — `languageBucket`'s "none" case never ships) —
  // enforced here too so a future build-script regression that shipped an
  // empty `names` object fails loudly at load time, not silently as a
  // blank label somewhere on the map.
  .refine((names) => Boolean(names.ckb ?? names.kmr ?? names.ar), {
    message: "a Kurdish place must carry at least one of ckb/kmr/ar",
  });

const kurdishPlaceSchema = z.object({
  id: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  names: kurdishPlaceNamesSchema,
});

export const kurdishPlacesSchema = z.array(kurdishPlaceSchema);

/** Derived from the zod schemas (like `events/emsc-schema.ts`'s
 * `EmscFeature` pattern) rather than hand-written interfaces — under this
 * project's `exactOptionalPropertyTypes: true`, a hand-written `ckb?:
 * string` is NOT assignable from zod's `.optional()` output (`string |
 * undefined`, an explicitly-present-but-undefined key), so deriving the
 * type FROM the schema is what keeps the two from drifting apart, not just
 * a style preference. */
export type KurdishPlaceNames = z.infer<typeof kurdishPlaceNamesSchema>;
export type KurdishPlace = z.infer<typeof kurdishPlaceSchema>;

/**
 * Validates a loaded Kurdish-places JSON asset at the IO boundary
 * (typescript-react-native.md: "Validate ALL external data ... with zod at
 * the IO boundary"). These two JSON files are bundled build output, not a
 * network response, but a plain `import` of a `.json` file is only as
 * trustworthy as `scripts/build-kurdish-places.mjs` staying in sync with
 * this shape — this is that check. Throws (with zod's own readable
 * message) on a shape mismatch, rather than letting a malformed record
 * surface as a silently-blank label somewhere on the map.
 */
export function parseKurdishPlaces(data: unknown): KurdishPlace[] {
  return kurdishPlacesSchema.parse(data);
}

/** Fixed per-locale fallback chains (wave brief: "ckb locale prefers
 * name:ckb then name:ar then default; kmr prefers name:ku then default;
 * ar prefers name:ar"). Unlike the gazetteer's `pickLocalizedName` (every
 * city has a hand-checked name in all four app locales, so it's a single
 * keyed lookup with no fallback needed), OSM coverage is uneven per place
 * — "default" here means whichever OTHER field the record happens to
 * carry, tried in a fixed order. The dataset has no separate
 * locale-neutral `name` field (dropped at build time — see
 * `build-kurdish-places.mjs`'s `compactRecord` doc comment), so `ar` is
 * the practical "most likely to exist" fallback for locales with no
 * dedicated OSM tag of their own (`en`, and any future locale). */
const NAME_FALLBACK_CHAINS: Record<string, readonly (keyof KurdishPlaceNames)[]> = {
  ckb: ["ckb", "ar", "kmr"],
  kmr: ["kmr", "ar", "ckb"],
  ar: ["ar", "ckb", "kmr"],
};
const DEFAULT_FALLBACK_CHAIN: readonly (keyof KurdishPlaceNames)[] = ["ar", "ckb", "kmr"];

/**
 * Resolves the label to show for `locale`, walking that locale's fallback
 * chain and returning the first language the record actually has. Returns
 * `null` (never a placeholder string) when the record has none of the
 * chain's languages at all — defensive only; every VALID record has at
 * least one of ckb/kmr/ar (`kurdishPlaceNamesSchema`'s refine), so this
 * only fires for a hand-built/malformed `names` object in a test. Callers
 * (`own-labels.ts`) skip rendering a feature entirely when this returns
 * `null`, rather than drawing an empty label.
 */
export function resolveKurdishPlaceName(
  names: KurdishPlaceNames,
  locale: string,
): string | null {
  const chain = NAME_FALLBACK_CHAINS[locale] ?? DEFAULT_FALLBACK_CHAIN;
  for (const key of chain) {
    const value = names[key];
    if (value) {
      return value;
    }
  }
  return null;
}
