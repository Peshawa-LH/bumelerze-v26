import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";
import { lookupHandbookData } from "../lookup";
import { SpectrumSection } from "../spectrum";
import type { Ec8GroundType } from "../spectrum/ec8";
import type { HandbookLookupResult } from "../types";
import { CoordinateInputForm } from "./CoordinateInputForm";
import { HandbookResultTable } from "./HandbookResultTable";

/**
 * Engineer's Handbook (spec-v1.md §7, design-brief.md §9) — the whole
 * screen's content, split out from `app/handbook.tsx` (which only wraps
 * this) so it's unit-testable without Expo Router's navigation context,
 * same "screen component vs. route file" split every other pushed screen
 * in this app uses (`CatalogListScreen`/`app/catalog.tsx`,
 * `HistoricalScreen` inline pattern). Deliberately tucked away in Settings
 * only (wave brief) — this is a professional-audience side tool, not a
 * panic-time screen, so it intentionally does NOT get the big-type/one-tap
 * treatment the felt-report flow gets.
 */
export function HandbookScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const [result, setResult] = useState<HandbookLookupResult | null>(null);

  function handleSubmit(lat: number, lon: number) {
    setResult(lookupHandbookData(lat, lon));
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.surface.base }}
      contentContainerStyle={{
        gap: spacing[5],
        padding: spacing[5],
        paddingBottom: insets.bottom + spacing[6],
      }}
    >
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("handbook.intro")}
      </Text>

      <CoordinateInputForm onSubmit={handleSubmit} />

      {result ? <HandbookResultTable result={result} /> : null}

      {/* Keyed on the coordinate so a new lookup starts a clean spectrum.
       * The form seeds Ss/S1 and the site class from the point ONCE per
       * mount, so without this a second lookup would silently keep the
       * first site's design values. */}
      {result ? (
        <SpectrumSection
          key={`${result.lat},${result.lon}`}
          vs30MS={result.vs30MS}
          ec8GroundType={(result.siteClass?.ec8 ?? null) as Ec8GroundType | null}
          isc2025={result.isc2025}
          lat={result.lat}
          lon={result.lon}
          locale={i18n.language}
        />
      ) : null}

      <View
        style={{
          borderWidth: 1,
          borderRadius: 12,
          borderColor: colors.border.default,
          backgroundColor: colors.surface.raised,
          padding: spacing[4],
        }}
      >
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {t("handbook.disclaimer")}
        </Text>
      </View>
    </ScrollView>
  );
}
