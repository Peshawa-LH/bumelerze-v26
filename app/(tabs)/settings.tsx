import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { pickLocalizedName } from "@/features/geo";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n";
import { useLocaleSwitcher } from "@/i18n/use-locale-switcher";
import {
  HOME_BASE_ELSEWHERE_ID,
  HOME_BASE_TOWNS,
  TownPicker,
  usePrefsStore,
  type HomeBasePreference,
} from "@/features/onboarding";
import { useDevicePermissions } from "@/features/permissions";
import { useTheme } from "@/theme";

const PRIVACY_POLICY_URL = "https://bumelerze.com/privacy.html";

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
      <DevicePermissionsSection />
      <HandbookSection />
      <MyDataSection />
      <FeedbackSection />
      <OnboardingSection />
      <FooterSection />
    </ScrollView>
  );
}

/** D26 item 7: a single row linking to the new My Data screen — the section
 * itself carries no state, so unlike every other section here it's just a
 * navigation trigger, same shape as `HandbookSection`'s "Open handbook"
 * row. */
function MyDataSection() {
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
        {t("settings.myDataSectionTitle")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("settings.myDataSectionDescription")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/my-data")}
        style={[styles.row, { borderColor: colors.border.default }]}
      >
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
          }}
        >
          {t("settings.myDataOpen")}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Owner directive: "In the settings tab we can implement a feedback message
 * where you press feedback then write a message ... I can get the list of
 * feedback then share them with you for fixes." A single navigation row,
 * same shape as `MyDataSection`/`HandbookSection` above — the form itself
 * lives on its own screen (`app/feedback.tsx`). Passes `screen: "settings"`
 * as a route param so the automatically-captured context
 * (`src/features/feedback/context.ts`) can record where this submission
 * came from without the feedback feature needing to know about every
 * possible entry point.
 */
function FeedbackSection() {
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
        {t("settings.feedbackSectionTitle")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("settings.feedbackSectionDescription")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: "/feedback", params: { screen: "settings" } })}
        style={[styles.row, { borderColor: colors.border.default }]}
      >
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
          }}
        >
          {t("settings.feedbackOpen")}
        </Text>
      </Pressable>
    </View>
  );
}

function permissionStatusText(
  status: "granted" | "denied" | "undetermined",
  t: (key: string) => string,
): string {
  if (status === "granted") {
    return t("settings.permissionsStatusGranted");
  }
  if (status === "denied") {
    return t("settings.permissionsStatusDenied");
  }
  return t("settings.permissionsStatusUndetermined");
}

/**
 * Owner directive (wave brief Part 3): "ONE button ... location, sensor,
 * and other permissions. I don't want a separate option for Sensor,
 * Location." Replaces the previous three separate permission surfaces
 * (a standalone "Location permission" section, a "Permissions & data"
 * section with its own per-row Allow buttons, and the Sensor screen as the
 * only place motion could be granted from) with one button that chains
 * every non-notification permission from a single tap
 * (`useDevicePermissions`'s own doc comment covers why the two underlying
 * requests are fired back to back rather than awaited in sequence — that
 * ordering is what keeps the web motion-permission prompt inside the
 * original tap's gesture). Notifications keep their own separate flow
 * (`NotificationsSection` below) per the brief: "keep the Notification
 * permission the same."
 */
function DevicePermissionsSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { locationStatus, motionStatus, isRequesting, requestAll } = useDevicePermissions();

  const hasDenied = locationStatus === "denied" || motionStatus === "denied";
  const allGranted = locationStatus === "granted" && motionStatus === "granted";

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
        {t("settings.devicePermissionsSectionTitle")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("settings.devicePermissionsSectionDescription")}
      </Text>

      {allGranted ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isRequesting }}
          disabled={isRequesting}
          onPress={requestAll}
          style={[styles.row, { borderColor: colors.border.default }]}
        >
          <Text
            style={{
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
            }}
          >
            {isRequesting
              ? t("settings.devicePermissionsRequestingButton")
              : t("settings.devicePermissionsAllowButton")}
          </Text>
        </Pressable>
      )}

      <View style={styles.spaceBetweenRow}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
          }}
        >
          {t("settings.devicePermissionsLocationLabel")}
        </Text>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
          }}
        >
          {permissionStatusText(locationStatus, t)}
        </Text>
      </View>
      <View style={styles.spaceBetweenRow}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
          }}
        >
          {t("settings.devicePermissionsMotionLabel")}
        </Text>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
          }}
        >
          {permissionStatusText(motionStatus, t)}
        </Text>
      </View>

      {hasDenied ? (
        <View style={{ gap: spacing[1] }}>
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyMeta.fontSize,
              lineHeight: typography.bodyMeta.lineHeight,
            }}
          >
            {Platform.OS === "web"
              ? t("settings.devicePermissionsSomeDeniedHintWeb")
              : t("settings.devicePermissionsSomeDeniedHint")}
          </Text>
          {/* `Linking.openSettings()` throws on web (no OS settings app to
           * deep-link into) — see `expo-linking`'s web implementation, which
           * has no `openSettings` at all. Only offer the action natively. */}
          {Platform.OS === "web" ? null : (
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
          )}
        </View>
      ) : null}
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

/** Owner feedback (wave brief Part 3): "Replay onboarding" alone confused
 * him ("I am not sure what this is"). Adds the description line every
 * other section here already has, explaining what the row does before the
 * user taps it — the row's own label and the confirm-dialog copy are
 * otherwise unchanged. */
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
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("settings.onboardingSectionDescription")}
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

/** Owner directive (wave brief Part 3): replaces the previous separate
 * "Data sources" and "Anonymous app-launch signal" sections with one short
 * footer — about blurb, a link to the full privacy policy (preserving the
 * telemetry disclosure the removed paragraph used to carry, just one tap
 * further away), the CC BY 4.0 attribution the EMSC/GEOFON license
 * requires, a trademark line, and the real app version.
 * [REVIEW copy]: `footerAbout` wording is the owner's own draft from the
 * wave brief, used verbatim — flagging per his "mark it so he can veto"
 * instruction. */
function FooterSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const appVersion = Constants.expoConfig?.version ?? "";

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("settings.footerAbout")}
      </Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
        hitSlop={12}
      >
        <Text
          style={{
            color: colors.text.link,
            fontSize: typography.labelButton.fontSize,
            fontWeight: typography.labelButton.fontWeight,
          }}
        >
          {t("settings.footerPrivacyLink")}
        </Text>
      </Pressable>
      <Text
        style={{
          color: colors.text.tertiary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("settings.footerAttribution")}
      </Text>
      <Text
        style={{
          color: colors.text.tertiary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("settings.footerTrademark")}
      </Text>
      {appVersion ? (
        <Text
          style={{
            color: colors.text.tertiary,
            fontSize: typography.bodyMeta.fontSize,
          }}
        >
          {t("settings.footerVersion", { version: appVersion })}
        </Text>
      ) : null}
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
