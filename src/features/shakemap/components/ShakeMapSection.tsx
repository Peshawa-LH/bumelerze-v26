import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatAbsoluteDual, isolateNumeric, type Event } from "@/features/events";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { useShakeMap } from "../queries";
import { ShakeMapView } from "./ShakeMapView";

export interface ShakeMapSectionProps {
  event: Event;
}

/**
 * Event Detail's lazy ShakeMap section (spec-v1.md §4.5): mounted
 * unconditionally by the screen (between Distance and Source), but renders
 * its own loading/offline states and — for the common no-ShakeMap-product
 * case — nothing at all, no empty shell (wave brief point 3). The section
 * title only appears alongside real content (loading text, the offline
 * notice, or the map itself), never as a bare heading over nothing.
 */
export function ShakeMapSection({ event }: ShakeMapSectionProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const shakeMap = useShakeMap(event.id, true);

  if (shakeMap.status === "absent") {
    return null;
  }

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

  if (shakeMap.status === "loading") {
    return (
      <View style={{ gap: spacing[1] }}>
        <Text style={titleStyle}>{t("eventDetail.shakemap.sectionTitle")}</Text>
        <Text style={bodyStyle}>{t("eventDetail.shakemap.loading")}</Text>
      </View>
    );
  }

  if (shakeMap.status === "unavailableOffline") {
    return (
      <View style={{ gap: spacing[1] }}>
        <Text style={titleStyle}>{t("eventDetail.shakemap.sectionTitle")}</Text>
        <Text style={bodyStyle}>{t("eventDetail.shakemap.unavailableOffline")}</Text>
      </View>
    );
  }

  // status === "ready" — TypeScript can't narrow `product`/`contours` off
  // the status string alone (queries.ts's own return type keeps them as
  // siblings, not a discriminated union), so guard explicitly rather than
  // asserting.
  if (!shakeMap.product || !shakeMap.contours) {
    return null;
  }

  const { local: updatedLocal } = formatAbsoluteDual(
    shakeMap.product.updateTime,
    i18n.language,
    t,
  );
  const versionText = localizeDigits(String(shakeMap.product.version), i18n.language);

  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={titleStyle}>{t("eventDetail.shakemap.sectionTitle")}</Text>
      <ShakeMapView
        contours={shakeMap.contours}
        epicenter={{ lat: event.lat, lon: event.lon }}
        locale={i18n.language}
        t={t}
      />
      <View style={{ gap: spacing[1] }}>
        <Text style={bodyStyle}>
          {t("eventDetail.shakemap.updated", { time: isolateNumeric(updatedLocal) })}
        </Text>
        {/* Citation only, same "cite, never link out" owner rule as the
         * event Source section below this one. */}
        <Text style={bodyStyle}>
          {t("eventDetail.shakemap.citation", {
            network: shakeMap.product.network,
            version: versionText,
          })}
        </Text>
      </View>
    </View>
  );
}
