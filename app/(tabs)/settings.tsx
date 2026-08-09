import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { pickLocalizedName } from "@/features/geo";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n";
import { useLocaleSwitcher } from "@/i18n/use-locale-switcher";
import { useLocationPermissionStatus } from "@/features/location";
import {
  HOME_BASE_ELSEWHERE_ID,
  HOME_BASE_TOWNS,
  TownPicker,
  usePrefsStore,
  type HomeBasePreference,
} from "@/features/onboarding";
import { useTheme } from "@/theme";

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const { isRestarting, selectLocale, currentLocale } = useLocaleSwitcher();

  async function handleSelectLocale(locale: SupportedLocale) {
    const { restartFailed } = await selectLocale(locale);
    if (restartFailed) {
      Alert.alert(t("settings.title"), t("settings.languageRestartFailedMessage"));
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.surface.base }}
      contentContainerStyle={[
        styles.container,
        {
          paddingTop: insets.top + spacing[6],
          paddingBottom: insets.bottom + spacing[6],
          paddingStart: spacing[5],
          paddingEnd: spacing[5],
          gap: spacing[6],
        },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h1.fontSize,
          lineHeight: typography.h1.lineHeight,
          fontWeight: typography.h1.fontWeight,
        }}
      >
        {t("settings.title")}
      </Text>

      <View style={{ gap: spacing[2] }}>
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.h3.fontSize,
            lineHeight: typography.h3.lineHeight,
            fontWeight: typography.h3.fontWeight,
          }}
        >
          {t("settings.languageSectionTitle")}
        </Text>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {isRestarting
            ? t("settings.languageRestartNotice")
            : t("settings.languageSectionDescription")}
        </Text>

        <View style={{ gap: spacing[2] }}>
          {SUPPORTED_LOCALES.map((locale) => {
            const isActive = currentLocale === locale;
            return (
              <Pressable
                key={locale}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive, disabled: isRestarting }}
                disabled={isRestarting}
                onPress={() => void handleSelectLocale(locale)}
                style={[
                  styles.row,
                  {
                    borderColor: colors.border.default,
                    backgroundColor: isActive ? colors.surface.raised : "transparent",
                  },
                ]}
              >
                <Text
                  style={{
                    color: colors.text.primary,
                    fontSize: typography.bodyDefault.fontSize,
                    fontWeight: isActive ? "700" : "400",
                  }}
                >
                  {t(`settings.languages.${locale}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <HomeBaseSection />
      <NotificationsSection />
      <LocationPermissionSection />
      <HandbookSection />
      <DataSourcesSection />
      <TelemetrySection />
      <OnboardingSection />
    </ScrollView>
  );
}

/** App-launch telemetry disclosure (spec-v1.md §5.4/§5.5, D11/D13: "disclosed
 * to the user in Settings... collected data is never hidden"). Text-only,
 * same pattern as `DataSourcesSection` above — there's no user-facing
 * detection feature built on this data yet (v1 ships only the ping itself),
 * so there's nothing to configure here, just disclose. */
function TelemetrySection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("settings.telemetrySectionTitle")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("settings.telemetrySectionDescription")}
      </Text>
    </View>
  );
}

/** Attribution/provenance section (wave brief point 3: "CC BY 4.0
 * attribution note ... added to the Settings about/provenance section").
 * Text-only — the event-detail source citation (app/event/[id].tsx) already
 * names the specific network per event; this section is the one place that
 * names BOTH providers and their shared license up front. */
function DataSourcesSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("settings.dataSourcesSectionTitle")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("settings.dataSourcesSectionDescription")}
      </Text>
    </View>
  );
}

function HandbookSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("settings.handbookSectionTitle")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("settings.handbookSectionDescription")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/handbook")}
        style={[styles.row, { borderColor: colors.border.default }]}
      >
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
          }}
        >
          {t("settings.handbookOpen")}
        </Text>
      </Pressable>
    </View>
  );
}

function NotificationsSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("settings.notificationsSectionTitle")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("settings.notificationsSectionDescription")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/notification-settings")}
        style={[styles.row, { borderColor: colors.border.default }]}
      >
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
          }}
        >
          {t("settings.notificationsManage")}
        </Text>
      </Pressable>
    </View>
  );
}

function HomeBaseSection() {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const homeBase = usePrefsStore((state) => state.homeBase);
  const setHomeBase = usePrefsStore((state) => state.setHomeBase);
  const [isPicking, setIsPicking] = useState(false);

  const currentTown = homeBase
    ? HOME_BASE_TOWNS.find((town) => town.id === homeBase.townId)
    : null;
  const currentLabel = currentTown
    ? pickLocalizedName(currentTown.names, i18n.language)
    : t("onboarding.homeBase.notSet");

  function handleSelectTown(townId: string) {
    const town = HOME_BASE_TOWNS.find((candidate) => candidate.id === townId);
    if (!town) {
      return;
    }
    const next: HomeBasePreference = { townId: town.id, lat: town.lat, lon: town.lon };
    setHomeBase(next);
    setIsPicking(false);
  }

  function handleSelectElsewhere() {
    setHomeBase(null);
    setIsPicking(false);
  }

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("settings.homeBaseSectionTitle")}
      </Text>
      <View style={styles.spaceBetweenRow}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {currentLabel}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsPicking((value) => !value)}
          hitSlop={12}
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("settings.homeBaseChange")}
          </Text>
        </Pressable>
      </View>
      {isPicking ? (
        <TownPicker
          selectedTownId={homeBase?.townId ?? HOME_BASE_ELSEWHERE_ID}
          onSelectTown={handleSelectTown}
          onSelectElsewhere={handleSelectElsewhere}
        />
      ) : null}
    </View>
  );
}

function LocationPermissionSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const status = useLocationPermissionStatus();

  const statusText =
    status === "granted"
      ? t("settings.locationStatusGranted")
      : status === "denied"
        ? t("settings.locationStatusDenied")
        : t("settings.locationStatusUndetermined");

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("settings.locationSectionTitle")}
      </Text>
      <View style={styles.spaceBetweenRow}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {statusText}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void Linking.openSettings()}
          hitSlop={12}
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("settings.openSystemSettings")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function OnboardingSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const resetOnboarding = usePrefsStore((state) => state.resetOnboarding);

  function handleReplay() {
    Alert.alert(
      t("settings.replayOnboardingConfirmTitle"),
      t("settings.replayOnboardingConfirmMessage"),
      [
        { text: t("settings.cancel"), style: "cancel" },
        { text: t("settings.replayOnboarding"), onPress: resetOnboarding },
      ],
    );
  }

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("settings.onboardingSectionTitle")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={handleReplay}
        style={[styles.row, { borderColor: colors.border.default }]}
      >
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
          }}
        >
          {t("settings.replayOnboarding")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
  },
  row: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingStart: 16,
    paddingEnd: 16,
  },
  spaceBetweenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
