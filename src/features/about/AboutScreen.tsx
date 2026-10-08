import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandMark } from "@/components/BrandMark";
import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsRow } from "@/features/account/components/SettingsRow";
import { useTheme } from "@/theme";

import {
  DATA_SOURCES,
  FONT_URL,
  FULL_SOURCES_URL,
  MAP_SOURCES,
  PRIVACY_POLICY_URL,
  SOURCE_CODE_URL,
  type AboutSource,
} from "./sources";

function openUrl(url: string) {
  void Linking.openURL(url);
}

function SectionTitle({ children }: { children: string }) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[
        typography.h3,
        { color: colors.text.primary, paddingHorizontal: spacing[1] },
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * About Bumelerze: the brand, the version, and every credit the app owes —
 * earthquake data providers with their licences, map data, the font and the
 * open-source licence — plus the privacy policy and trademark line. It
 * replaces the long licence paragraph that used to sit in the Settings footer
 * (owner, 2026-10-08: that belongs on an About screen, as in other
 * professional apps). The map's own on-map attribution control is separate and
 * untouched: that one is a licence requirement of the tile providers.
 */
export function AboutScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const appVersion = Constants.expoConfig?.version ?? "";

  function sourceRow(source: AboutSource) {
    return (
      <SettingsRow
        key={source.id}
        icon={source.icon}
        label={source.name ?? t(`about.sources.${source.id}.label`)}
        value={t(`about.sources.${source.id}.value`)}
        valueLayout="stacked"
        valueLines={5}
        trailing="external"
        accessibilityHint={t("about.opensInBrowser")}
        onPress={() => openUrl(source.url)}
        testID={`about-source-${source.id}`}
      />
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.surface.base }}
      contentContainerStyle={{
        paddingTop: spacing[5],
        paddingBottom: insets.bottom + spacing[6],
        paddingStart: spacing[5],
        paddingEnd: spacing[5],
        gap: spacing[6],
      }}
    >
      <View style={{ gap: spacing[3] }}>
        <BrandMark />
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {t("settings.footerAbout")}
        </Text>
      </View>

      <SettingsGroup testID="about-group-version">
        <SettingsRow
          icon="information-circle-outline"
          label={t("about.version")}
          value={appVersion}
          trailing="none"
          testID="about-version"
        />
      </SettingsGroup>

      <View style={{ gap: spacing[3] }}>
        <SectionTitle>{t("about.sectionData")}</SectionTitle>
        <SettingsGroup testID="about-group-data">
          {DATA_SOURCES.map(sourceRow)}
        </SettingsGroup>
      </View>

      <View style={{ gap: spacing[3] }}>
        <SectionTitle>{t("about.sectionMaps")}</SectionTitle>
        <SettingsGroup testID="about-group-maps">
          {MAP_SOURCES.map(sourceRow)}
        </SettingsGroup>
      </View>

      <View style={{ gap: spacing[3] }}>
        <SectionTitle>{t("about.sectionSoftware")}</SectionTitle>
        <SettingsGroup testID="about-group-software">
          <SettingsRow
            icon="text-outline"
            label="Vazirmatn"
            value={t("about.fontValue")}
            valueLayout="stacked"
            valueLines={3}
            trailing="external"
            accessibilityHint={t("about.opensInBrowser")}
            onPress={() => openUrl(FONT_URL)}
            testID="about-font"
          />
          <SettingsRow
            icon="code-slash-outline"
            label={t("about.openSource")}
            value="github.com/Peshawa-LH/bumelerze-v26"
            valueLayout="stacked"
            trailing="external"
            accessibilityHint={t("about.opensInBrowser")}
            onPress={() => openUrl(SOURCE_CODE_URL)}
            testID="about-open-source"
          />
        </SettingsGroup>
      </View>

      <View style={{ gap: spacing[3] }}>
        <SectionTitle>{t("about.sectionLegal")}</SectionTitle>
        <SettingsGroup testID="about-group-legal">
          <SettingsRow
            icon="shield-checkmark-outline"
            label={t("settings.footerPrivacyLink")}
            trailing="external"
            accessibilityHint={t("about.opensInBrowser")}
            onPress={() => openUrl(PRIVACY_POLICY_URL)}
            testID="about-privacy"
          />
          <SettingsRow
            icon="document-text-outline"
            label={t("about.fullSources")}
            trailing="external"
            accessibilityHint={t("about.opensInBrowser")}
            onPress={() => openUrl(FULL_SOURCES_URL)}
            testID="about-full-sources"
          />
        </SettingsGroup>
        <Text
          style={{
            color: colors.text.tertiary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
            paddingHorizontal: spacing[1],
          }}
        >
          {t("settings.footerTrademark")}
        </Text>
      </View>
    </ScrollView>
  );
}
