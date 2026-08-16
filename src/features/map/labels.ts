/**
 * Label language by app locale — Sorani (`ckb`) and Arabic (`ar`) prefer
 * Arabic-script place names over the Latin/transliterated names both
 * OpenFreeMap's OpenMapTiles-schema vector tiles and MapTiler's own vector
 * schema carry by default (Kurmanji/English keep the default names, no
 * transform needed).
 *
 * OpenMapTiles' schema explicitly lists `ar` among its supported name
 * languages (`openmaptiles.yaml`, `languages:` block — verified live against
 * the upstream repo 2026-08-16), so `name:ar` is a real per-feature property
 * on the same vector tiles OpenFreeMap serves, even though OpenFreeMap's
 * *default* style expression doesn't reference it (it renders
 * `name:latin`/`name:nonlatin` pairs instead — verified against the live
 * `liberty` style.json). MapTiler's vector schema is OpenMapTiles-derived
 * too and documented as carrying the same per-language `name:xx` fields.
 * Rather than trying to special-case each style's existing (and differently
 * shaped) label expression, this module replaces any name-labeling symbol
 * layer's `text-field` outright with one `coalesce(name:ar, name)`
 * expression, on both providers alike.
 */
import { ARABIC_SCRIPT_LOCALES, type SupportedLocale } from "@/i18n";

/** Deliberately narrower than maplibre-gl's own `LayerSpecification` union
 * (plain `string` for `type` rather than its closed literal union) — see
 * the identical rationale on `terrain.ts`'s `StyleLayerTypeInfo`. A real
 * style's `layers` array is structurally assignable here regardless. */
export interface StyleLayerLike {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
}

/** `true` for `ckb`/`ar` — same locale set the theme layer already treats
 * as Arabic-script (`use-theme.ts`), reused here rather than re-deciding
 * the same thing a second way. */
export function shouldLocalizeToArabicScript(locale: string): boolean {
  return ARABIC_SCRIPT_LOCALES.includes(locale as SupportedLocale);
}

/** Fresh array each call (not a shared module-level constant) — MapLibre's
 * internal style processing can freeze/retain expression arrays it's given,
 * so handing out a new one per call avoids any risk of one call site's
 * mutation (however unlikely) leaking into another's. */
export function buildArabicNameTextField(): unknown[] {
  return ["coalesce", ["get", "name:ar"], ["get", "name"]];
}

/**
 * Recursively checks whether a MapLibre expression contains a `["get",
 * "<field>"]` targeting a name-ish field (`name`, `name_en`, `name:latin`,
 * `name:nonlatin`, `name:ar`, ...) — i.e. whether this expression is
 * plausibly a place-name label rather than e.g. a road-shield `["get",
 * "ref"]` or a fixed string. Pure structural walk, no assumptions about
 * which exact shape a given style author chose.
 */
function referencesNameField(expression: unknown): boolean {
  if (Array.isArray(expression)) {
    if (
      expression[0] === "get" &&
      typeof expression[1] === "string" &&
      expression[1].startsWith("name")
    ) {
      return true;
    }
    return expression.some((item) => referencesNameField(item));
  }
  return false;
}

/** A layer is a "name label" layer when it's a `symbol` layer whose
 * `layout["text-field"]` references a name-ish field per
 * `referencesNameField` above. Layers whose `text-field` is unrelated to
 * names (road-shield `ref` layers, fixed strings) are left untouched. */
export function isNameLabelLayer(
  layer: Pick<StyleLayerLike, "type" | "layout">,
): boolean {
  if (layer.type !== "symbol") {
    return false;
  }
  const textField = layer.layout?.["text-field"];
  return textField !== undefined && referencesNameField(textField);
}

/** Pure transform over `style.layers` — returns just the ids of the
 * name-label layers, in style order. Wiring code (`map.web.tsx`) is what
 * actually calls `map.setLayoutProperty(id, "text-field", ...)` for each,
 * caching each layer's ORIGINAL `text-field` first so switching back to a
 * non-Arabic-script locale can restore it exactly rather than guessing. */
export function findNameLabelLayerIds(layers: readonly StyleLayerLike[]): string[] {
  return layers.filter(isNameLabelLayer).map((layer) => layer.id);
}
