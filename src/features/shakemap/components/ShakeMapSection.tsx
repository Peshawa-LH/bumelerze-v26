import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatAbsoluteDual, isolateNumeric, type Event } from "@/features/events";
import { placeLine } from "@/features/geo";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { useResolvedShakeMap } from "../live-queries";
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
 * no-product-at-all case (wave brief point 3, unchanged).
 *
 * "Closing the last gap" wave: reads `useResolvedShakeMap` (`../live-
 * queries`) rather than the bundled-only `useShakeMap` directly — that hook
 * prefers a LIVE `shakemap_products` product when one exists and loaded,
 * falls back to the build-time bundled Atlas (the 11 curated Historical
 * events) otherwise, and shows nothing when neither exists
 * (`resolver.ts`'s precedence). No loading/offline state is rendered here
 * either way: a slow or failed live fetch silently falls back rather than
 * ever blocking or erroring this section (see that hook's own doc
 * comment).
 *
 * The citation line still names OUR OWN producer ("Bumelerze", never
 * "USGS", regardless of source) plus the D21 provenance-as-UI trio: a
 * data-used summary (what conditioned this map, if anything), the
 * computing engine's own version (live products only — see `engineVersion`
 * below), and a review-status line (automatic/provisional vs.
 * scientist-reviewed) — provisional is never shown as if it were
 * authoritative.
 */
export function ShakeMapSection({ event }: ShakeMapSectionProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const shakeMap = useResolvedShakeMap(event, true);

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
  // Engine-provenance line — live products only (`resolver.ts` normalizes
  // a bundled-source result's `engineVersion` to `null`; see that field's
  // own doc comment in `live-types.ts` for why). Omitted entirely rather
  // than shown blank when the underlying engine-version block wasn't
  // published for this product.
  const engineVersionText = product.engineVersion?.serviceVersion
    ? t("eventDetail.shakemap.engineVersion", {
        version: localizeDigits(product.engineVersion.serviceVersion, i18n.language),
      })
    : null;
  // Screen-reader place context (accessibility-tester Phase 5 pass): a
  // sighted user sees the epicenter + nearby-city labels drawn on the SVG
  // map; the map's own accessibilityLabel is a blind user's ONLY way to get
  // that "where" information, so it must carry the same localized place
  // line the rest of the screen already uses, not just the max-intensity
  // numeral (see `ShakeMapView`'s `mapA11yLabel` doc comment).
  const placeText = placeLine(event, i18n.language, t);

  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={titleStyle}>{t("eventDetail.shakemap.sectionTitle")}</Text>
      <ShakeMapView
        contours={contours}
        epicenter={{ lat: event.lat, lon: event.lon }}
        locale={i18n.language}
        t={t}
        placeText={placeText}
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
         * which engine build computed it (live products only), and whether
         * a scientist has reviewed it — provisional ("automatic") is
         * always visibly labelled, never shown as if it were authoritative
         * (`reviewStatus.automatic`'s own copy: "not yet reviewed by a
         * scientist"). */}
        <Text style={bodyStyle}>{dataUsedText}</Text>
        {engineVersionText ? <Text style={bodyStyle}>{engineVersionText}</Text> : null}
        <Text style={bodyStyle}>{reviewStatusText}</Text>
      </View>
    </View>
  );
}
