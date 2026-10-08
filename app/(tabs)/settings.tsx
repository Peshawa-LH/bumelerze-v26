import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandMark } from "@/components/BrandMark";
import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsOptionList } from "@/features/account/components/SettingsOptionList";
import { SettingsRow, SettingsRowBody } from "@/features/account/components/SettingsRow";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n";
import { useLocaleSwitcher } from "@/i18n/use-locale-switcher";
import { confirmDialog, messageDialog } from "@/lib/dialogs";
import { usePrefsStore } from "@/features/onboarding";
import { useDevicePermissions } from "@/features/permissions";
import {
  THEME_PREFERENCES,
  useTheme,
  useThemePreferencesStore,
  type ThemePreference,
} from "@/theme";

/** The rows that open in place; only one is open at a time. */
type OpenRow = "permissions" | "language" | "appearance";

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [openRow, setOpenRow] = useState<OpenRow | null>(null);

  const { isRestarting, selectLocale, currentLocale } = useLocaleSwitcher();
  const themePreference = useThemePreferencesStore((state) => state.preference);
  const setThemePreference = useThemePreferencesStore((state) => state.setPreference);
  const resetOnboarding = usePrefsStore((state) => state.resetOnboarding);

  async function handleSelectLocale(locale: SupportedLocale) {
    const { restartFailed } = await selectLocale(locale);
    if (restartFailed) {
      messageDialog(t("settings.title"), t("settings.languageRestartFailedMessage"));
    }
  }

  function handleReplayOnboarding() {
    confirmDialog({
      title: t("settings.replayOnboardingConfirmTitle"),
      message: t("settings.replayOnboardingConfirmMessage"),
      confirmLabel: t("settings.replayOnboarding"),
      cancelLabel: t("settings.cancel"),
      onConfirm: resetOnboarding,
    });
  }

  function toggle(row: OpenRow) {
    setOpenRow((current) => (current === row ? null : row));
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

      {/* Grouped rows like My account (owner note N1, 2026-10-07): one card per
          concern, one short line or none under a title. Order is the owner's
          (feedback 2adfbbf7, 2026-09-27, regrouped 2026-10-07): the account
          first (the place the tagged building will live) with the engineer's
          handbook; then the device concerns, language and look; then
          feedback and onboarding. */}
      <SettingsGroup testID="settings-group-account">
        <SettingsRow
          icon="person-circle-outline"
          label={t("settings.myDataSectionTitle")}
          value={t("settings.myDataSectionDescription")}
          valueLayout="stacked"
          onPress={() => router.push("/my-data")}
          testID="settings-row-account"
        />
        <SettingsRow
          icon="construct-outline"
          label={t("settings.handbookSectionTitle")}
          value={t("settings.handbookSectionDescription")}
          valueLayout="stacked"
          onPress={() => router.push("/handbook")}
          testID="settings-row-handbook"
        />
      </SettingsGroup>

      <SettingsGroup testID="settings-group-device">
        <SettingsRow
          icon="notifications-outline"
          label={t("settings.notificationsSectionTitle")}
          onPress={() => router.push("/notification-settings")}
          testID="settings-row-notifications"
        />
        <View>
          <SettingsRow
            icon="location-outline"
            label={t("settings.devicePermissionsSectionTitle")}
            value={t("settings.devicePermissionsSectionDescription")}
            valueLayout="stacked"
            trailing="expand"
            expanded={openRow === "permissions"}
            onPress={() => toggle("permissions")}
            testID="settings-row-permissions"
          />
          {openRow === "permissions" ? <DevicePermissionsBody /> : null}
        </View>
        <View>
          <SettingsRow
            icon="language-outline"
            label={t("settings.languageSectionTitle")}
            value={t(`settings.languageNative.${currentLocale}`)}
            trailing="expand"
            expanded={openRow === "language"}
            onPress={() => toggle("language")}
            testID="settings-row-language"
          />
          {openRow === "language" ? (
            <LanguageBody
              currentLocale={currentLocale}
              isRestarting={isRestarting}
              onSelectLocale={(locale) => void handleSelectLocale(locale)}
            />
          ) : null}
        </View>
        <View>
          <SettingsRow
            icon="contrast-outline"
            label={t("settings.appearanceSectionTitle")}
            value={t(`settings.appearance.${themePreference}`)}
            trailing="expand"
            expanded={openRow === "appearance"}
            onPress={() => toggle("appearance")}
            testID="settings-row-appearance"
          />
          {openRow === "appearance" ? (
            <AppearanceBody
              preference={themePreference}
              onSelectPreference={setThemePreference}
            />
          ) : null}
        </View>
      </SettingsGroup>

      <SettingsGroup testID="settings-group-help">
        <SettingsRow
          icon="chatbubble-ellipses-outline"
          label={t("settings.feedbackSectionTitle")}
          value={t("settings.feedbackSectionDescription")}
          valueLayout="stacked"
          onPress={() => router.push("/feedback")}
          testID="settings-row-feedback"
        />
        <SettingsRow
          icon="compass-outline"
          label={t("settings.appTour")}
          onPress={() => router.push("/tour")}
          testID="settings-row-tour"
        />
        <SettingsRow
          icon="refresh-outline"
          label={t("settings.replayOnboarding")}
          trailing="none"
          onPress={handleReplayOnboarding}
          testID="settings-row-onboarding"
        />
        <SettingsRow
          icon="information-circle-outline"
          label={t("about.title")}
          onPress={() => router.push("/about")}
          testID="settings-row-about"
        />
      </SettingsGroup>

      <FooterSection />
    </ScrollView>
  );
}

interface LanguageBodyProps {
  currentLocale: SupportedLocale;
  isRestarting: boolean;
  onSelectLocale: (locale: SupportedLocale) => void;
}

/** The language options under the Language row. Switching to or from a
 * right-to-left language restarts the app; that is said when it happens
 * (the restart notice below), not as a standing paragraph. */
function LanguageBody({
  currentLocale,
  isRestarting,
  onSelectLocale,
}: LanguageBodyProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  return (
    <SettingsRowBody>
      {isRestarting ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {t("settings.languageRestartNotice")}
        </Text>
      ) : null}
      <SettingsOptionList
        options={SUPPORTED_LOCALES.map((locale) => ({
          value: locale,
          label: t(`settings.languages.${locale}`),
        }))}
        selected={currentLocale}
        onSelect={onSelectLocale}
        disabled={isRestarting}
        testIDPrefix="settings-language-option"
      />
    </SettingsRowBody>
  );
}

interface AppearanceBodyProps {
  preference: ThemePreference;
  onSelectPreference: (preference: ThemePreference) => void;
}

/** Owner directive (2026-09-27): Automatic (the default, follows the system)
 * or manually Light / Dark. Shown with the same option list as Language
 * (owner, 2026-10-08). The choice takes effect immediately: `useTheme()`
 * reads from the same store. */
function AppearanceBody({ preference, onSelectPreference }: AppearanceBodyProps) {
  const { t } = useTranslation();

  return (
    <SettingsRowBody>
      <SettingsOptionList
        options={THEME_PREFERENCES.map((option) => ({
          value: option,
          label: t(`settings.appearance.${option}`),
        }))}
        selected={preference}
        onSelect={onSelectPreference}
        testIDPrefix="settings-appearance-option"
      />
    </SettingsRowBody>
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
 * Location." One button chains every non-notification permission from a
 * single tap (`useDevicePermissions`'s own doc comment covers why the two
 * underlying requests are fired back to back rather than awaited in
 * sequence: that ordering keeps the web motion-permission prompt inside the
 * original tap's gesture). Notifications keep their own flow.
 */
function DevicePermissionsBody() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { locationStatus, motionStatus, isRequesting, requestAll } =
    useDevicePermissions();

  const hasDenied = locationStatus === "denied" || motionStatus === "denied";
  const allGranted = locationStatus === "granted" && motionStatus === "granted";

  return (
    <SettingsRowBody>
      <View style={{ gap: spacing[2] }}>
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
      </View>

      {allGranted ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isRequesting }}
          disabled={isRequesting}
          onPress={requestAll}
          style={[
            styles.option,
            {
              borderColor: colors.border.default,
              paddingVertical: spacing[2],
              paddingStart: spacing[4],
              paddingEnd: spacing[4],
            },
          ]}
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
    </SettingsRowBody>
  );
}

/**
 * The Settings footer is only the brand mark and the version (owner,
 * 2026-10-08). Everything else that used to sit here (the privacy link, the
 * data licences, the trademark line) lives on the About screen, which this
 * footer also opens when tapped. The logo is the owner's own horizontal mark
 * (feedback 59b3eaa9, `assets/brand/README.md`); see `BrandMark`.
 */
function FooterSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const appVersion = Constants.expoConfig?.version ?? "";
  const versionText = appVersion
    ? t("settings.footerVersion", { version: appVersion })
    : "";

  return (
    <Pressable
      testID="settings-footer"
      accessibilityRole="button"
      accessibilityLabel={
        versionText
          ? `${t("settings.footerLogoA11yLabel")}, ${versionText}`
          : t("settings.footerLogoA11yLabel")
      }
      accessibilityHint={t("about.title")}
      onPress={() => router.push("/about")}
      hitSlop={8}
      style={{ gap: spacing[2], paddingTop: spacing[4] }}
    >
      <BrandMark />
      {versionText ? (
        <Text
          style={{
            color: colors.text.tertiary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {versionText}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
  },
  option: {
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
  },
  spaceBetweenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
