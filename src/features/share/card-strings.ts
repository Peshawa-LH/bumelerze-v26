import { agencyDisplayLabel } from "@/features/events/agency-labels";
import { formatAbsoluteDual, formatMagnitudeValue } from "@/features/events/format";
import type { Event } from "@/features/events/types";
import { placeLine, type TranslateFn } from "@/features/geo";
import type { ReviewStatus } from "@/features/shakemap/types";

import type { CardStrings } from "./card-layout";
import { SHARE_SITE_TEXT } from "./config";

/** At most this many agencies are named in the card credit. */
const MAX_CREDIT_AGENCIES = 3;

export interface CardStringsInput {
  event: Pick<Event, "originTime" | "lat" | "lon" | "magnitude" | "provenance">;
  locale: string;
  t: TranslateFn;
  /** Authoring-agency codes from the event registry, when known. */
  agencies?: readonly string[] | undefined;
  /** `null`: no shakemap for this event. */
  reviewStatus: ReviewStatus | null;
}

/** The agencies named in the credit: the registry's authors, or the feed
 * provider the event came from when the registry has nothing yet. */
export function creditSources(
  agencies: readonly string[] | undefined,
  provider: Event["provenance"]["provider"],
  t: TranslateFn,
): string {
  const labels = [...new Set((agencies ?? []).map(agencyDisplayLabel))].slice(
    0,
    MAX_CREDIT_AGENCIES,
  );
  return (labels.length > 0 ? labels : [t(`events.provenance.${provider}`)]).join(", ");
}

/**
 * The magnitude display ("M 3.2", "٣.٢ پلە") split around the number, using
 * the app's own `events.magnitudeDisplay` template so wording stays in one
 * place. The number is swapped for a marker, the template run, and cut there.
 */
export function splitMagnitudeDisplay(
  render: (value: string) => string,
  value: string,
): CardStrings["magnitude"] {
  const marker = "\u0001";
  const [prefix = "", suffix = ""] = render(marker).split(marker);
  return { prefix, value, suffix };
}

/** Every localized string the card shows, resolved up front so the layout
 * stays pure data. Same place rule, time formatter and numerals as the app. */
export function buildCardStrings({
  event,
  locale,
  t,
  agencies,
  reviewStatus,
}: CardStringsInput): CardStrings {
  const sources = creditSources(agencies, event.provenance.provider, t);
  return {
    magnitude: splitMagnitudeDisplay(
      (value) => t("events.magnitudeDisplay", { value }),
      formatMagnitudeValue(event.magnitude.value, locale),
    ),
    place: placeLine(event, locale, t),
    time: formatAbsoluteDual(event.originTime, locale, t).local,
    legendCaption: t("share.card.legend"),
    automaticNote: reviewStatus === "automatic" ? t("share.card.automatic") : null,
    siteText: SHARE_SITE_TEXT,
    kmUnit: t("units.km"),
    credit: t(reviewStatus === null ? "share.card.creditNoMap" : "share.card.credit", {
      sources,
    }),
    prompt: t("share.card.prompt"),
  };
}
