import Constants from "expo-constants";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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

const PRIVACY_POLICY_URL = "https://bumelerze.com/privacy.html";

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const { isRestarting, selectLocale, currentLocale } = useLocaleSwitcher();
  const themePreference = useThemePreferencesStore((state) => state.preference);
  const setThemePreference = useThemePreferencesStore((state) => state.setPreference);

  async function handleSelectLocale(locale: SupportedLocale) {
    const { restartFailed } = await selectLocale(locale);
    if (restartFailed) {
      messageDialog(t("settings.title"), t("settings.languageRestartFailedMessage"));
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

      {/* Order is the owner's (feedback 2adfbbf7, 2026-09-27): the account
          first — the place the tagged building will live — then the
          engineer's handbook, then the two device concerns, then language,
          feedback and onboarding. */}
      <MyDataSection />
      <HandbookSection />
      <DevicePermissionsSection />
      <NotificationsSection />
      <LanguageSection
        currentLocale={currentLocale}
        isRestarting={isRestarting}
        onSelectLocale={(locale) => void handleSelectLocale(locale)}
      />
      <AppearanceSection
        preference={themePreference}
        onSelectPreference={setThemePreference}
      />
      <FeedbackSection />
      <OnboardingSection />
      <FooterSection />
    </ScrollView>
  );
}

interface LanguageSectionProps {
  currentLocale: SupportedLocale;
  isRestarting: boolean;
  onSelectLocale: (locale: SupportedLocale) => void;
}

/** The language picker, once inline at the top of the screen — now a
 * section like the others so the owner's order can put it fifth. */
function LanguageSection({
  currentLocale,
  isRestarting,
  onSelectLocale,
}: LanguageSectionProps) {
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
              onPress={() => onSelectLocale(locale)}
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
  );
}

interface AppearanceSectionProps {
  preference: ThemePreference;
  onSelectPreference: (preference: ThemePreference) => void;
}

/** Owner directive (2026-09-27): "in Settings, where appropriate, 3
 * buttons: Automatic (the default, follows the system) or manually Light /
 * Dark." A segmented row rather than `LanguageSection`'s stacked rows —
 * three short, mutually-exclusive labels read better side by side, and
 * `accessibilityRole="radio"` matches that "exactly one of these" shape
 * (unlike the language list, which is a plain list of buttons). The active
 * choice takes effect immediately: `useTheme()` reads straight from the
 * same store, no reload needed (no RTL/script flip is involved, unlike the
 * language switcher above). */
function AppearanceSection({ preference, onSelectPreference }: AppearanceSectionProps) {
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
        {t("settings.appearanceSectionTitle")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("settings.appearanceSectionDescription")}
      </Text>

      <View style={[styles.segmentedRow, { gap: spacing[2] }]}>
        {THEME_PREFERENCES.map((option) => {
          const isActive = preference === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: isActive }}
              onPress={() => onSelectPreference(option)}
              style={[
                styles.segmentedButton,
                {
                  borderColor: colors.border.default,
                  backgroundColor: isActive ? colors.brand.primary : "transparent",
                },
              ]}
            >
              <Text
                style={{
                  color: isActive ? colors.brand.onPrimary : colors.text.primary,
                  fontSize: typography.bodyDefault.fontSize,
                  fontWeight: isActive ? "700" : "400",
                }}
              >
                {t(`settings.appearance.${option}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
 * lives on its own screen (`app/feedback.tsx`). Used to also pass
 * `screen: "settings"` as a route param so the automatically-captured
 * context could record where a submission came from; migration 0022 drops
 * the matching `feedback.screen` column (owner: never wanted, never
 * populated with anything meaningful), so this is now a plain navigation
 * with no params.
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
        onPress={() => router.push("/feedback")}
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
  const { locationStatus, motionStatus, isRequesting, requestAll } =
    useDevicePermissions();

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
    confirmDialog({
      title: t("settings.replayOnboardingConfirmTitle"),
      message: t("settings.replayOnboardingConfirmMessage"),
      confirmLabel: t("settings.replayOnboarding"),
      cancelLabel: t("settings.cancel"),
      onConfirm: resetOnboarding,
    });
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
/**
 * The app's one branded surface (owner, feedback 59b3eaa9, kept simple on
 * 2026-09-27: "the logo of the app and a trademark for Bumelerze" in the
 * Settings footer). The primary horizontal mark on light, the reversed
 * mark on dark — the owner's own logo package (`assets/brand/README.md`),
 * rendered by `expo-image` the same way the MapTiler mark is; there is no
 * SVG-as-component transformer in this app and none is needed for a
 * static image. The copy is the owner's shortened footer: one sentence,
 * the privacy link, the data licence, the app version, the trademark.
 */
function FooterSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing, scheme } = useTheme();
  const appVersion = Constants.expoConfig?.version ?? "";
  const logoSource =
    scheme === "dark"
      ? require("../../assets/brand/logo/bumelerze-primary-horizontal-reversed.svg")
      : require("../../assets/brand/logo/bumelerze-primary-horizontal.svg");

  return (
    <View style={{ gap: spacing[3], paddingTop: spacing[4] }}>
      <Image
        source={logoSource}
        contentFit="contain"
        accessibilityLabel={t("settings.footerLogoA11yLabel")}
        style={styles.footerLogo}
      />
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
      {appVersion ? (
        <Text
          style={{
            color: colors.text.tertiary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {t("settings.footerVersion", { version: appVersion })}
        </Text>
      ) : null}
      <Text
        style={{
          color: colors.text.tertiary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("settings.footerTrademark")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
  },
  // The horizontal mark's own 5:1 box (`viewBox="0 0 1800 360"`), at a
  // width that reads as a signature rather than a banner. `alignSelf`
  // keeps it at the reading start under RTL.
  footerLogo: {
    width: 180,
    height: 36,
    alignSelf: "flex-start",
  },
  row: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingStart: 16,
    paddingEnd: 16,
  },
  // `flexDirection: "row"` alone flips correctly under RTL (RN mirrors row
  // direction with `I18nManager.isRTL`) — no logical-property gymnastics
  // needed beyond that, unlike absolute left/right offsets elsewhere.
  segmentedRow: {
    flexDirection: "row",
  },
  segmentedButton: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  spaceBetweenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
