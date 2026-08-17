export type {
  AtlasBundleEntry,
  ContourRing,
  DataUsedSummaryKey,
  IntensityContourLevel,
  IntensityContourSet,
  ReviewStatus,
} from "./types";
export { parseIntensityContours } from "./contours";
export { ATLAS_INDEX, ATLAS_EVENT_IDS } from "./atlas";
export { mmiValueToLevel, INTENSITY_ROMAN_NUMERALS } from "./intensity-ramp";
export {
  computeContourBoundingBox,
  createEquirectangularProjector,
  type LonLatBoundingBox,
  type Projector,
  type Viewport,
} from "./projection";
export { pickMapCities } from "./cities";
export {
  layoutCityLabels,
  type LabelCandidate,
  type PlacedLabel,
  type TextAnchor,
} from "./label-layout";
export { useShakeMap, type UseShakeMapResult, type UseShakeMapStatus } from "./queries";
export { BASEMAP_BBOX, BASEMAP_BORDERS, BASEMAP_COASTLINE, type BasemapLine } from "./basemap/basemap";
export { clipLineToBbox } from "./projection";
export { ShakeMapView, type ShakeMapViewProps } from "./components/ShakeMapView";
export { ShakeMapSection, type ShakeMapSectionProps } from "./components/ShakeMapSection";

// "Closing the last gap" wave — live shakemap_products path.
export {
  LIVE_SHAKEMAP_PRODUCT_ROW_COLUMNS,
  computeDataUsedSummaryKey,
  extractEngineVersion,
  parseLiveShakeMapProductRows,
  selectLatestLiveProductRow,
  type EngineVersionSummary,
  type LiveShakeMapProduct,
  type LiveShakeMapProductRow,
  type ParsedLiveShakeMapProductRows,
} from "./live-types";
export { SupabaseLiveShakeMapTransport, type LiveShakeMapTransport } from "./live-transport";
export {
  liveShakeMapQueryKeys,
  useLiveShakeMap,
  useResolvedShakeMap,
  type UseResolvedShakeMapResult,
} from "./live-queries";
export {
  resolveShakeMapProduct,
  type ResolvedShakeMap,
  type ResolvedShakeMapProduct,
  type ShakeMapCandidate,
  type ShakeMapProductSource,
} from "./resolver";
