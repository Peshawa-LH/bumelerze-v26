import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useEventSourceAgencies, type Event } from "@/features/events";
import { magnitudeTone } from "@/features/events/magnitude-tone";
import { useResolvedShakeMap } from "@/features/shakemap/live-queries";
import { lightColors } from "@/theme/semantic";

import { buildCardModel, type CardModel } from "./card-layout";
import { buildCardStrings } from "./card-strings";
import { buildShareUrl } from "./caption";
import type { ShareCardSize } from "./types";

/**
 * The share image's model builder for one earthquake: the same card for the
 * share sheet's images and the Event hub's first slide (review note 4.3),
 * rebuilt only when something it shows changes (the SHAKEmap can arrive
 * later than the page).
 */
export function useShareCardModel(
  event: Event,
  shareId: string,
): (size: ShareCardSize) => CardModel {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const shake = useResolvedShakeMap(event, true);
  const agencies = useEventSourceAgencies([event]).get(event.id)?.agencies;
  const url = buildShareUrl(shareId);

  const contours = shake.contours;
  const reviewStatus = shake.product?.reviewStatus ?? null;
  const epicenter = contours?.epicenter ?? { lat: event.lat, lon: event.lon };
  const epicenterLat = epicenter.lat;
  const epicenterLon = epicenter.lon;
  const agencyKey = (agencies ?? []).join(",");

  return useCallback(
    (size: ShareCardSize): CardModel =>
      buildCardModel({
        size,
        locale,
        strings: buildCardStrings({
          event,
          locale,
          t,
          agencies: agencyKey === "" ? undefined : agencyKey.split(","),
          reviewStatus: contours ? reviewStatus : null,
        }),
        magnitudeValue: event.magnitude.value,
        epicenter: { lat: epicenterLat, lon: epicenterLon },
        contours,
        url,
        colors: lightColors,
        magnitudeBandColor:
          lightColors.magnitudeBand[magnitudeTone(event.magnitude.value)],
      }),
    [
      event,
      locale,
      t,
      agencyKey,
      contours,
      reviewStatus,
      epicenterLat,
      epicenterLon,
      url,
    ],
  );
}
