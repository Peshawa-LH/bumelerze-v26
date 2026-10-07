import type { ComponentType } from "react";

import type { TourStopId } from "../../stops";
import { AccountPreview } from "./AccountPreview";
import { FeltPreview } from "./FeltPreview";
import { HomePreview } from "./HomePreview";
import { HubPreview } from "./HubPreview";
import { MapPreview } from "./MapPreview";
import { SafetyPreview } from "./SafetyPreview";
import { SensorPreview } from "./SensorPreview";
import { SharePreview } from "./SharePreview";

/** The live preview drawn above each stop's text. */
export const TOUR_PREVIEWS: Record<TourStopId, ComponentType> = {
  home: HomePreview,
  felt: FeltPreview,
  hub: HubPreview,
  map: MapPreview,
  sensor: SensorPreview,
  safety: SafetyPreview,
  account: AccountPreview,
  share: SharePreview,
};
