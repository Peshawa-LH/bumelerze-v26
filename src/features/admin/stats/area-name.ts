import type { TFunction } from "i18next";

import { GAZETTEER_CITIES, pickLocalizedName } from "@/features/geo/gazetteer";

/** A gazetteer town id in the reader's language; "other" (and an unknown id)
 * reads "Other areas". */
export function areaName(area: string | null, locale: string, t: TFunction): string {
  const city = area ? GAZETTEER_CITIES.find((c) => c.id === area) : undefined;
  return city ? pickLocalizedName(city.names, locale) : t("officials.otherAreas");
}
