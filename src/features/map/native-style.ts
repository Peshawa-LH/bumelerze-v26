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

/** Forgets the documents fetched this session (tests). */
export function clearStyleSessionCache(): void {
  sessionCache.clear();
}

async function fetchStyle(url: string, fetchImpl: typeof fetch, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`style ${response.status}`);
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
 * run. Rejects only when none of the three has it, which the caller treats
 * like the web treats a style that fails to load.
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
