import type { ComponentType } from "react";

import type { TourStopId } from "../../stops";
import { CatalogPreview } from "./CatalogPreview";
import { FeltPreview } from "./FeltPreview";
import { HandbookPreview } from "./HandbookPreview";
import { HomePreview } from "./HomePreview";
import { HubPreview } from "./HubPreview";
import { MapPreview } from "./MapPreview";
import { SafePreview } from "./SafePreview";
import { SafetyPreview } from "./SafetyPreview";
import { SensorPreview } from "./SensorPreview";
import { SharePreview } from "./SharePreview";

/** The live preview drawn above each stop's text. */
export const TOUR_PREVIEWS: Record<TourStopId, ComponentType> = {
  home: HomePreview,
  felt: FeltPreview,
  safe: SafePreview,
  hub: HubPreview,
  map: MapPreview,
  catalog: CatalogPreview,
  sensor: SensorPreview,
  safety: SafetyPreview,
  handbook: HandbookPreview,
  share: SharePreview,
};
