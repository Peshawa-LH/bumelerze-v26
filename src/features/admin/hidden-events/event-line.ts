import { useTranslation } from "react-i18next";

import {
  formatAbsoluteDual,
  formatDateOnly,
  formatIsolatedDistance,
  formatMagnitudeValue,
  isolateLocalizedTime,
  isolateNumeric,
} from "@/features/events/format";
import type { HiddenEventCard, HideCandidate } from "./transport";

/** A crowd-detected possible earthquake (owner choice 3): no magnitude, no
 * place, no Bumelerze id. The candidates list does not say its status, so a
 * row with none of the three counts as one too. */
function isPossible(event: HiddenEventCard): boolean {
  return (
    event.status === "possible" ||
    (event.magnitude === null && !event.place && !event.bumelerzeId)
  );
}

/** "M 5.1 · Near Ranya · 1 Oct 2026 · bml2026x01", as in Open a hub and the
 * Home screen tool; "Unconfirmed shaking nearby · 1 Oct 2026" for a possible
 * earthquake. */
export function useEventLine() {
  const { t, i18n } = useTranslation();
  return (event: HiddenEventCard) =>
    [
      // Named as Home names one whose area is not known.
      isPossible(event) ? t("home.possibleEvent.staleTitleUnknownArea") : null,
      event.magnitude !== null
        ? t("admin.hubs.magnitude", {
            value: isolateNumeric(formatMagnitudeValue(event.magnitude, i18n.language)),
          })
        : null,
      event.place,
      formatDateOnly(event.originTime, i18n.language, t),
      event.bumelerzeId ? isolateNumeric(event.bumelerzeId) : null,
    ]
      .filter(Boolean)
      .join(" · ");
}

/** A choice for "Card that stays": the same line with the phone's local
 * time instead of the date (the choices are minutes apart) and the
 * distance from the earthquake being hidden. */
export function useCandidateLine() {
  const { t, i18n } = useTranslation();
  return (event: HideCandidate) =>
    [
      isPossible(event) ? t("home.possibleEvent.staleTitleUnknownArea") : null,
      event.magnitude !== null
        ? t("admin.hubs.magnitude", {
            value: isolateNumeric(formatMagnitudeValue(event.magnitude, i18n.language)),
          })
        : null,
      event.place,
      isolateLocalizedTime(formatAbsoluteDual(event.originTime, i18n.language, t).local),
      event.distanceKm !== null
        ? formatIsolatedDistance(event.distanceKm, i18n.language, t("units.km"))
        : null,
      event.bumelerzeId ? isolateNumeric(event.bumelerzeId) : null,
    ]
      .filter(Boolean)
      .join(" · ");
}
