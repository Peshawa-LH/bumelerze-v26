/**
 * The basemap style document for MapLibre Native (iOS/Android).
 *
 * The web hands maplibre-gl the style URL and then edits the live map:
 * Arabic-script place names for ckb/ar (`labels.ts`), the AWS hillshade
 * when a style has no relief of its own (`terrain.ts`), and it reads the
 * style's label font for the own Kurdish labels (`own-labels.ts`).
 * MapLibre React Native cannot edit a basemap layer it did not declare, so
 * the native maps fetch the same style JSON, make the same edits to it with
 * the same pure helpers, and hand MapLibre Native the finished document.
 *
 * The raw documents are kept on the device (AsyncStorage), so a map opened
 * offline still gets its localised labels and hillshade; tiles, glyphs and
 * sprites come from MapLibre Native's own offline cache.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import {
  buildArabicNameTextField,
  findNameLabelLayerIds,
  shouldLocalizeToArabicScript,
  type StyleLayerLike,
} from "./labels";
import { OWN_LABELS_DEFAULT_FONT } from "./own-labels";
import type { MapColorScheme } from "./style-provider";
import {
  buildTerrainDemSource,
  buildTerrainHillshadeLayer,
  findFirstSymbolLayerId,
  findHillshadeBeforeLayerId,
  styleHasRasterDemSource,
  TERRAIN_DEM_SOURCE_ID,
} from "./terrain";

/** IO boundary: only what the edits below rely on is checked; every other
 * key passes through untouched for MapLibre Native to read. */
const styleLayerSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    layout: z.record(z.unknown()).optional(),
  })
  .passthrough();

const styleDocumentSchema = z
  .object({
    version: z.number(),
    sources: z.record(z.object({ type: z.string() }).passthrough()),
    layers: z.array(styleLayerSchema),
  })
  .passthrough();

export type StyleDocument = z.infer<typeof styleDocumentSchema>;
type StyleLayer = z.infer<typeof styleLayerSchema>;

/** A style document, or `null` when `raw` is not one. */
export function parseStyleDocument(raw: unknown): StyleDocument | null {
  const result = styleDocumentSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export interface NativeStyleOptions {
  locale: string;
  scheme: MapColorScheme;
  /** Add the AWS hillshade when the style has no `raster-dem` of its own
   * (the Map tab and the SHAKEmap do; the small pickers do not). */
  terrain: boolean;
  /** Invisible placeholder layers to add under the first label layer,
   * bottom to top (`insertAnchorLayers`). */
  anchorLayerIds?: readonly string[];
  /** Arabic-script basemap names for ckb/ar (default). The web localises
   * the Map tab only; its SHAKEmap and small maps keep the style's own
   * names, so those pass `false`. */
  localizeLabels?: boolean;
}

export interface PreparedNativeStyle {
  style: StyleDocument;
  /** The first symbol layer: overlays and SHAKEmap bands go under it, so
   * place names stay readable (`findFirstSymbolLayerId`). */
  firstSymbolLayerId: string | undefined;
  /** The style's own label font, for the own Kurdish labels (the web reads
   * it off the live map the same way; glyphs then always exist). */
  ownLabelsFont: readonly string[];
}

function fontOf(layer: StyleLayer | undefined): readonly string[] {
  const font = layer?.layout?.["text-font"];
  return Array.isArray(font) &&
    font.length > 0 &&
    font.every((f) => typeof f === "string")
    ? (font as string[])
    : OWN_LABELS_DEFAULT_FONT;
}

/**
 * The web's load-time edits, applied to a copy of `doc`:
 * - for ckb/ar, every name label reads `coalesce(name:ar, name)` (the web's
 *   `applyLocaleLabels`);
 * - with `terrain`, the AWS terrarium DEM and its hillshade, under the
 *   first line/symbol layer, unless the style ships its own relief (the
 *   web's `primeTerrainAndLabelCache`).
 */
export function prepareNativeMapStyle(
  doc: StyleDocument,
  options: NativeStyleOptions,
): PreparedNativeStyle {
  const style = JSON.parse(JSON.stringify(doc)) as StyleDocument;
  const nameLabelLayerIds = new Set(
    findNameLabelLayerIds(style.layers as unknown as StyleLayerLike[]),
  );
  const firstNameLabel = style.layers.find((layer) => nameLabelLayerIds.has(layer.id));
  const ownLabelsFont = fontOf(firstNameLabel);

  if (options.localizeLabels !== false && shouldLocalizeToArabicScript(options.locale)) {
    for (const layer of style.layers) {
      if (nameLabelLayerIds.has(layer.id)) {
        layer.layout = { ...layer.layout, "text-field": buildArabicNameTextField() };
      }
    }
  }

  if (options.terrain && !styleHasRasterDemSource(style.sources)) {
    style.sources[TERRAIN_DEM_SOURCE_ID] = buildTerrainDemSource();
    const hillshade = buildTerrainHillshadeLayer(options.scheme) as unknown as StyleLayer;
    const beforeId = findHillshadeBeforeLayerId(style.layers);
    const index = beforeId
      ? style.layers.findIndex((layer) => layer.id === beforeId)
      : -1;
    if (index >= 0) style.layers.splice(index, 0, hillshade);
    else style.layers.push(hillshade);
  }

  insertAnchorLayers(style, options.anchorLayerIds ?? []);
  resolveHillshadeColorExpressions(style);

  return {
    style,
    firstSymbolLayerId: findFirstSymbolLayerId(style.layers),
    ownLabelsFont,
  };
}

/**
 * Adds invisible, empty placeholder layers under the style's first label
 * layer, so the app's own layers can be slotted in at a fixed place by
 * naming the placeholder as their `beforeId`.
 *
 * Why: in MapLibre React Native 11.5 a layer whose `beforeId` CHANGES
 * after it is on the map is removed and never put back (its iOS
 * `setBelowLayerID` clears the style it re-inserts into). The web's rule
 * "each overlay under the next one switched on above it" means changing
 * `beforeId`s, so the native map gives every overlay a fixed placeholder
 * instead, in stack order, and the order holds whatever is switched on
 * when. A hidden `background` layer needs no source and draws nothing.
 */
export function insertAnchorLayers(
  style: StyleDocument,
  anchorLayerIds: readonly string[],
) {
  if (anchorLayerIds.length === 0) return;
  const anchors = anchorLayerIds.map(
    (id) =>
      ({
        id,
        type: "background",
        layout: { visibility: "none" },
      }) as unknown as StyleLayer,
  );
  const firstSymbolId = findFirstSymbolLayerId(style.layers);
  const index = firstSymbolId
    ? style.layers.findIndex((layer) => layer.id === firstSymbolId)
    : -1;
  if (index >= 0) style.layers.splice(index, 0, ...anchors);
  else style.layers.push(...anchors);
}

// ---------------------------------------------------------------------------
// Hillshade colours MapLibre Native cannot read
// ---------------------------------------------------------------------------

const HILLSHADE_COLOR_PROPERTIES = [
  "hillshade-shadow-color",
  "hillshade-highlight-color",
  "hillshade-accent-color",
] as const;

/** The zoom a zoom-dependent hillshade colour is resolved at: between the
 * Map tab's region view (about 5.5) and Home (about 8); the SHAKEmap opens
 * near 6–7. */
export const HILLSHADE_COLOR_ZOOM = 7;

type Rgba = [number, number, number, number];

/** `#rgb`, `#rrggbb`, `rgb()`, `rgba()`, `hsl()` and `hsla()` → RGBA. */
export function parseCssColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const h = hex[1] as string;
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
    const n = Number.parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text);
  if (!fn) return null;
  const parts = (fn[2] as string).split(/[\s,/]+/).filter(Boolean);
  const num = (part: string | undefined) => Number.parseFloat(part ?? "");
  const alpha =
    parts[3] !== undefined ? num(parts[3]) * (parts[3].endsWith("%") ? 0.01 : 1) : 1;
  if ((fn[1] as string).startsWith("rgb")) {
    return [num(parts[0]), num(parts[1]), num(parts[2]), alpha];
  }
  const hue = (((num(parts[0]) % 360) + 360) % 360) / 360;
  const sat = num(parts[1]) / 100;
  const light = num(parts[2]) / 100;
  if (![hue, sat, light, alpha].every(Number.isFinite)) return null;
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const v =
      u < 1 / 6
        ? p + (q - p) * 6 * u
        : u < 1 / 2
          ? q
          : u < 2 / 3
            ? p + (q - p) * (2 / 3 - u) * 6
            : p;
    return v * 255;
  };
  return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3), alpha];
}

function rgbaString([r, g, b, a]: Rgba): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${Math.round(a * 1000) / 1000})`;
}

/**
 * A zoom-dependent colour (`interpolate` or `step` on `["zoom"]` with plain
 * colour stops) evaluated at `zoom`, as MapLibre would draw it there
 * (`interpolate` mixes in RGB); `null` for anything else.
 */
export function evaluateZoomColor(expression: unknown, zoom: number): string | null {
  if (!Array.isArray(expression)) return null;
  const [op, a, b] = expression as unknown[];
  const isZoom = (v: unknown) => Array.isArray(v) && v[0] === "zoom";
  if (op === "step" && isZoom(a)) {
    let out = expression[2];
    for (let i = 3; i + 1 < expression.length; i += 2) {
      if (zoom >= (expression[i] as number)) out = expression[i + 1];
    }
    return typeof out === "string" && parseCssColor(out) ? out : null;
  }
  if (op !== "interpolate" || !isZoom(b)) return null;
  const base =
    Array.isArray(a) && a[0] === "exponential" && typeof a[1] === "number" ? a[1] : 1;
  const stops: [number, Rgba][] = [];
  for (let i = 3; i + 1 < expression.length; i += 2) {
    const color =
      typeof expression[i + 1] === "string"
        ? parseCssColor(expression[i + 1] as string)
        : null;
    if (typeof expression[i] !== "number" || !color) return null;
    stops.push([expression[i] as number, color]);
  }
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return null;
  if (zoom <= first[0]) return rgbaString(first[1]);
  if (zoom >= last[0]) return rgbaString(last[1]);
  for (let i = 0; i + 1 < stops.length; i += 1) {
    const [z0, c0] = stops[i] as [number, Rgba];
    const [z1, c1] = stops[i + 1] as [number, Rgba];
    if (zoom > z1) continue;
    const span = z1 - z0;
    const t =
      span === 0
        ? 0
        : base === 1
          ? (zoom - z0) / span
          : (Math.pow(base, zoom - z0) - 1) / (Math.pow(base, span) - 1);
    return rgbaString(c0.map((v, k) => v + ((c1[k] as number) - v) * t) as Rgba);
  }
  return rgbaString(last[1]);
}

/**
 * MapLibre Native (11.x) reads the hillshade shadow, highlight and accent
 * colours as a colour LIST (multi-directional hillshade) and rejects a
 * zoom expression that yields single colours ("Expected array<color> but
 * found string"), which drops the layer: MapTiler's light outdoor style
 * zooms its shadow colour, so the light basemap lost all relief on iOS
 * (simulator, 2026-10-21). A plain colour still reads fine, so such an
 * expression becomes its colour at `HILLSHADE_COLOR_ZOOM`.
 */
export function resolveHillshadeColorExpressions(
  style: StyleDocument,
  zoom: number = HILLSHADE_COLOR_ZOOM,
): void {
  for (const layer of style.layers) {
    if (layer.type !== "hillshade") continue;
    const paint = (layer as { paint?: Record<string, unknown> }).paint;
    if (!paint) continue;
    for (const property of HILLSHADE_COLOR_PROPERTIES) {
      const value = paint[property];
      if (!Array.isArray(value)) continue;
      const color = evaluateZoomColor(value, zoom);
      if (color) paint[property] = color;
      else delete paint[property];
    }
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "bumelerze.map-style:";
const FETCH_TIMEOUT_MS = 10_000;

/** Storage key for a style URL, without the MapTiler key, so a rotated key
 * still finds the document saved under the old one. */
export function styleStorageKey(url: string): string {
  return STORAGE_PREFIX + url.replace(/([?&])key=[^&]*/, "$1key");
}

interface StyleStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface LoadStyleDeps {
  fetchImpl?: typeof fetch;
  storage?: StyleStorage;
  timeoutMs?: number;
}

const sessionCache = new Map<string, StyleDocument>();

/** The style server said no (a bad key, a used-up monthly quota). Unlike a
 * failed connection, the saved copy cannot help: its tile URLs need the same
 * refused key, so it would open as an empty basemap. */
class StyleRefusedError extends Error {}

const REFUSED_STATUSES = new Set([401, 403, 429]);

/** Forgets the documents fetched this session (tests). */
export function clearStyleSessionCache(): void {
  sessionCache.clear();
}

async function fetchStyle(url: string, fetchImpl: typeof fetch, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      const message = `style ${response.status}`;
      throw REFUSED_STATUSES.has(response.status)
        ? new StyleRefusedError(message)
        : new Error(message);
    }
    const doc = parseStyleDocument(await response.json());
    if (!doc) throw new Error("style document has the wrong shape");
    return doc;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The style document behind `url`: from this session's memory, else the
 * network (then saved on the device), else the copy saved on an earlier
 * run. Rejects when none of the three has it, and when the server refused
 * the request (`StyleRefusedError`): the caller treats both like the web
 * treats a style that fails to load, so a MapTiler map whose monthly quota
 * ran out falls back to OpenFreeMap instead of opening an empty saved copy.
 */
export async function loadStyleDocument(
  url: string,
  deps: LoadStyleDeps = {},
): Promise<StyleDocument> {
  const cached = sessionCache.get(url);
  if (cached) return cached;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const storage = deps.storage ?? AsyncStorage;
  const key = styleStorageKey(url);
  try {
    const doc = await fetchStyle(url, fetchImpl, deps.timeoutMs ?? FETCH_TIMEOUT_MS);
    sessionCache.set(url, doc);
    storage.setItem(key, JSON.stringify(doc)).catch(() => {
      // A full disk only costs the offline copy; the map itself has it.
    });
    return doc;
  } catch (networkError) {
    if (networkError instanceof StyleRefusedError) throw networkError;
    const saved = await storage.getItem(key).catch(() => null);
    const doc = saved ? parseStyleDocument(safeJson(saved)) : null;
    if (doc) {
      sessionCache.set(url, doc);
      return doc;
    }
    throw networkError instanceof Error ? networkError : new Error(String(networkError));
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
