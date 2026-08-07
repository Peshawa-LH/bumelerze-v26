import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatAbsoluteDual, isolateNumeric, type Event } from "@/features/events";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { useShakeMap } from "../queries";
import type { DataUsedSummaryKey } from "../types";
import { ShakeMapView } from "./ShakeMapView";

export interface ShakeMapSectionProps {
  event: Event;
}

/** `AtlasBundleEntry.dataUsedSummaryKey` -> its i18n key, one-to-one
 * (`types.ts`'s own doc comment on `DataUsedSummaryKey`). A `Record` (not
 * a template-string interpolation into the i18n key) so a typo/unknown
 * key can never silently produce a broken/missing translation lookup. */
const DATA_USED_I18N_KEY: Record<DataUsedSummaryKey, string> = {
  catalogOnly: "eventDetail.shakemap.dataUsed.catalogOnly",
  stationConditioned: "eventDetail.shakemap.dataUsed.stationConditioned",
  dyfiConditioned: "eventDetail.shakemap.dataUsed.dyfiConditioned",
  stationAndDyfiConditioned: "eventDetail.shakemap.dataUsed.stationAndDyfiConditioned",
};

/**
 * Event Detail's ShakeMap section (spec-v1.md §4.5; D21 rewrite,
 * `docs/decisions.md`: "Displayed maps are ALWAYS
 * bumelerze-shake-service products ... interim display default: where our
 * product doesn't exist yet, the ShakeMap section shows nothing — absence
 * over misattribution"). Mounted unconditionally by the screen (between
 * Distance and Source); renders nothing at all for the common
 * no-bundled-product case (wave brief point 3, unchanged) — no loading or
 * offline state exists anymore, since the bundled Atlas lookup
 * (`useShakeMap`) is synchronous and local, never a network fetch.
 *
 * The citation line now names OUR OWN producer ("Bumelerze", never
 * "USGS") plus the D21 provenance-as-UI pair: a data-used summary (what
 * conditioned this map, if anything) and a review-status line (automatic
 * vs. scientist-reviewed).
 */
export function ShakeMapSection({ event }: ShakeMapSectionProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const shakeMap = useShakeMap(event.id, true);

  // TypeScript can't narrow `product`/`contours` off `status` alone
  // (queries.ts's return type keeps them as siblings, not a discriminated
  // union), so guard explicitly rather than asserting.
  if (shakeMap.status === "absent" || !shakeMap.product || !shakeMap.contours) {
    return null;
  }
  const { product, contours } = shakeMap;

  const titleStyle = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    lineHeight: typography.labelCaption.lineHeight,
    fontWeight: typography.labelCaption.fontWeight,
  } as const;
  const bodyStyle = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const { local: generatedLocal } = formatAbsoluteDual(
    Date.parse(product.generatedAt),
    i18n.language,
    t,
  );
  const versionText = localizeDigits(String(product.version), i18n.language);
  const dataUsedText = t(DATA_USED_I18N_KEY[product.dataUsedSummaryKey]);
  const reviewStatusText = t(`eventDetail.shakemap.reviewStatus.${product.reviewStatus}`);

  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={titleStyle}>{t("eventDetail.shakemap.sectionTitle")}</Text>
      <ShakeMapView
        contours={contours}
        epicenter={{ lat: event.lat, lon: event.lon }}
        locale={i18n.language}
        t={t}
      />
      <View style={{ gap: spacing[1] }}>
        <Text style={bodyStyle}>
          {t("eventDetail.shakemap.updated", { time: isolateNumeric(generatedLocal) })}
        </Text>
        {/* Citation only, same "cite, never link out" owner rule as the
         * event Source section below this one — producer is ALWAYS
         * "Bumelerze" now (D21: never USGS, never any other outside
         * producer). */}
        <Text style={bodyStyle}>
          {t("eventDetail.shakemap.citation", {
            producer: "Bumelerze",
            version: versionText,
          })}
        </Text>
        {/* D21 provenance-as-UI: what data (if any) conditioned this map,
         * and whether a scientist has reviewed it. */}
        <Text style={bodyStyle}>{dataUsedText}</Text>
        <Text style={bodyStyle}>{reviewStatusText}</Text>
      </View>
    </View>
  );
}
