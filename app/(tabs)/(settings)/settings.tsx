import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandMark } from "@/components/BrandMark";
import { MyLocationRow } from "@/features/account/components/MyLocationRow";
import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsOptionList } from "@/features/account/components/SettingsOptionList";
import { SettingsRow, SettingsRowBody } from "@/features/account/components/SettingsRow";
import { GuidelinesRow } from "@/features/guidelines";
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
import { useTabBarScroll } from "@/features/tab-bar";

/** The rows that open in place; only one is open at a time. */
type OpenRow = "permissions" | "language" | "appearance";

export default function SettingsScreen() {
  const tabBarScroll = useTabBarScroll();
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
      {...tabBarScroll}
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

      {/* Grouped rows (owner note N1, 2026-10-07): one card per concern, one
          short line or none under a title. Order since D79 (2026-10-08): the
          read-and-learn guides first (the Safety guide left the tab bar, so
          it lives here, and the engineer's handbook), then what belongs to
          this device (My location, Notifications, permissions, language,
          look), then feedback and onboarding. "My account" is gone: it is
          the Profile tab now. */}
      <SettingsGroup testID="settings-group-guides">
        <SettingsRow
          icon="shield-checkmark-outline"
          label={t("settings.safetyGuideTitle")}
          value={t("settings.safetyGuideDescription")}
          valueLayout="stacked"
          onPress={() => router.push("/safety")}
          testID="settings-row-safety"
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
        <MyLocationRow />
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
        <GuidelinesRow />
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

const PRIVACY_POLICY_URL = "https://bumelerze.com/privacy.html";

/**
 * The Settings footer (owner, 2026-10-08: no About screen, a minimal footer
 * about Bumelerze): the owner's horizontal mark, one sentence, the privacy
 * link, the data credit the EMSC/GEOFON licences ask for, the app version
 * and the trademark line.
 */
function FooterSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const appVersion = Constants.expoConfig?.version ?? "";
  const meta = {
    color: colors.text.tertiary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  };

  return (
    <View testID="settings-footer" style={{ gap: spacing[3], paddingTop: spacing[4] }}>
      <BrandMark />
      <Text style={[meta, { color: colors.text.secondary }]}>
        {t("settings.footerAbout")}
      </Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
        hitSlop={12}
        style={{ alignSelf: "flex-start" }}
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
      <Text style={meta}>{t("settings.footerData")}</Text>
      {appVersion ? (
        <Text style={meta}>{t("settings.footerVersion", { version: appVersion })}</Text>
      ) : null}
      <Text style={meta}>{t("settings.footerTrademark")}</Text>
    </View>
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
