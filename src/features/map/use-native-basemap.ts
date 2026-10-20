import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  prepareNativeMapStyle,
  loadStyleDocument,
  type StyleDocument,
} from "./native-style";
import { resolveCatalogMapStyle, type MapStyleCatalogId } from "./style-catalog";
import {
  decideMapErrorAction,
  getConfiguredMapTilerKey,
  resolveMapStyleForKey,
  type MapColorScheme,
  type MapStyleProviderId,
} from "./style-provider";

/**
 * The basemap behind every native map (Map tab, SHAKEmap, pin map, station
 * map, coordinate picker), with the web's provider rules:
 *
 * - MapTiler with the configured key, OpenFreeMap without one;
 * - one silent fall-back to OpenFreeMap when a MapTiler style fails before
 *   the map ever showed (`decideMapErrorAction`, never a loop);
 * - after that, the offline state, and Retry starts over on MapTiler.
 *
 * The style document goes through `native-style.ts` (localised labels,
 * hillshade). When neither the network nor the device has it, the plain
 * style URL is handed to MapLibre Native, whose own offline cache may
 * still hold it; only if that fails too does the map report an error.
 *
 * A new style choice swaps the style of the live map, as on the web: the
 * map, its camera and its layers stay, MapLibre re-adds the app's layers
 * on the new style.
 */
export interface NativeBasemapOptions {
  /** The saved style choice (Map tab, pin and station maps); without one,
   * the default outdoor family (SHAKEmap and coordinate picker, as on the
   * web). */
  styleId?: MapStyleCatalogId;
  scheme: MapColorScheme;
  locale: string;
  terrain: boolean;
  /** Placeholder layers for the caller's own layers (`insertAnchorLayers`). */
  anchorLayerIds?: readonly string[];
  /** See `NativeStyleOptions.localizeLabels` (default true). */
  localizeLabels?: boolean;
  /** `false` holds everything back (the saved style choice is still
   * loading from storage). */
  enabled?: boolean;
}

export type NativeBasemapPhase = "resolving" | "loading" | "ready" | "error";

export interface NativeBasemap {
  phase: NativeBasemapPhase;
  /** What to hand `<Map mapStyle>`; `null` until the first document is in. */
  mapStyle: StyleDocument | string | null;
  /** The provider of the style on screen (the MapTiler logo follows it). */
  provider: MapStyleProviderId;
  firstSymbolLayerId: string | undefined;
  ownLabelsFont: readonly string[] | undefined;
  /** Changes when the native map must be built again (fall-back, Retry). */
  mapKey: number;
  onDidFinishLoadingMap: () => void;
  onDidFailLoadingMap: () => void;
  retry: () => void;
}

interface Shown {
  mapStyle: StyleDocument | string;
  provider: MapStyleProviderId;
  firstSymbolLayerId: string | undefined;
  ownLabelsFont: readonly string[] | undefined;
}

export function useNativeBasemap({
  styleId,
  scheme,
  locale,
  terrain,
  anchorLayerIds,
  localizeLabels = true,
  enabled = true,
}: NativeBasemapOptions): NativeBasemap {
  const [fellBack, setFellBack] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mapKey, setMapKey] = useState(0);
  const [phase, setPhase] = useState<NativeBasemapPhase>("resolving");
  const [shown, setShown] = useState<Shown | null>(null);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // A fresh style pick gets a fresh shot at MapTiler (the web's
  // `handleStyleChange` resets its fall-back latch the same way).
  const lastStyleIdRef = useRef(styleId);
  useEffect(() => {
    if (lastStyleIdRef.current === styleId) return;
    lastStyleIdRef.current = styleId;
    setFellBack(false);
  }, [styleId]);

  const resolved = useMemo(() => {
    const key = getConfiguredMapTilerKey();
    const force = fellBack ? "openfreemap" : undefined;
    return styleId
      ? resolveCatalogMapStyle(styleId, scheme, key, force)
      : resolveMapStyleForKey(scheme, key, force);
  }, [styleId, scheme, fellBack]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadStyleDocument(resolved.url)
      .then((doc) => {
        if (cancelled) return;
        const prepared = prepareNativeMapStyle(doc, {
          locale,
          scheme,
          terrain,
          localizeLabels,
          ...(anchorLayerIds ? { anchorLayerIds } : {}),
        });
        setShown({
          mapStyle: prepared.style,
          provider: resolved.provider,
          firstSymbolLayerId: prepared.firstSymbolLayerId,
          ownLabelsFont: prepared.ownLabelsFont,
        });
        setPhase((current) => (current === "resolving" ? "loading" : current));
      })
      .catch(() => {
        if (cancelled) return;
        // Same rule as a failed style load on the web: MapTiler gets one
        // silent fall-back before the map has ever shown.
        const action = decideMapErrorAction({
          provider: resolved.provider,
          hasReachedReady: phaseRef.current === "ready",
          alreadyFellBack: fellBack,
        });
        if (action === "fallback-to-openfreemap") {
          setFellBack(true);
          return;
        }
        setShown({
          mapStyle: resolved.url,
          provider: resolved.provider,
          firstSymbolLayerId: undefined,
          ownLabelsFont: undefined,
        });
        setPhase((current) => (current === "resolving" ? "loading" : current));
      });
    return () => {
      cancelled = true;
    };
    // `anchorLayerIds` is a module constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, resolved, locale, scheme, terrain, localizeLabels, fellBack, attempt]);

  const onDidFinishLoadingMap = useCallback(() => setPhase("ready"), []);

  const onDidFailLoadingMap = useCallback(() => {
    const action = decideMapErrorAction({
      provider: shown?.provider ?? resolved.provider,
      hasReachedReady: phaseRef.current === "ready",
      alreadyFellBack: fellBack,
    });
    if (action === "fallback-to-openfreemap") {
      setFellBack(true);
      setPhase("loading");
      setMapKey((key) => key + 1);
      return;
    }
    setPhase("error");
  }, [shown, resolved.provider, fellBack]);

  const retry = useCallback(() => {
    setFellBack(false);
    setShown(null);
    setPhase("resolving");
    setMapKey((key) => key + 1);
    setAttempt((value) => value + 1);
  }, []);

  return {
    phase,
    mapStyle: shown?.mapStyle ?? null,
    provider: shown?.provider ?? resolved.provider,
    firstSymbolLayerId: shown?.firstSymbolLayerId,
    ownLabelsFont: shown?.ownLabelsFont,
    mapKey,
    onDidFinishLoadingMap,
    onDidFailLoadingMap,
    retry,
  };
}
