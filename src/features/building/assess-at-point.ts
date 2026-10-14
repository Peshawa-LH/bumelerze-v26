import { siteHazard } from "@/features/handbook/site-hazard";

import { assessBuildingWithHazard, type Assessment } from "./assessment";
import type { Answers } from "./questionnaire";

/**
 * The full automatic assessment of a home at (lat, lon), hazard included,
 * in one synchronous call. Reads the handbook's hazard maps directly, so
 * keep it out of screens' static imports: the app saves through
 * `service.ts`, which loads the maps on demand.
 */
export function assessBuilding(answers: Answers, lat: number, lon: number): Assessment {
  return assessBuildingWithHazard(answers, lat, lon, siteHazard(lat, lon));
}
