import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { pickLocalizedName } from "@/features/geo";
import { formatMagnitudeValue } from "@/features/events";
import {
  ensureNotificationPermission,
  fireRehearsalNotification,
  PermissionDeniedRow,
  RehearsalAlertModal,
  TierSelector,
  useNotificationPermissionStatus,
  type NotificationPermissionStatus,
} from "@/features/notifications";
import {
  HOME_BASE_ELSEWHERE_ID,
  HOME_BASE_TOWNS,
  TownPicker,
  usePrefsStore,
  type NotificationTier,
} from "@/features/onboarding";
import { useTheme } from "@/theme";

/** Fixed example event for the rehearsal buttons (spec-v1.md §4.10/B8) —
 * not a real event, never fetched, chosen only to be a realistic-looking
 * magnitude/place pair for the mock. */
const REHEARSAL_EXAMPLE_MAGNITUDE = 4.8;

export default function NotificationSettingsScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const nearMeTier = usePrefsStore((state) => state.nearMeTier);
  const setNearMeTier = usePrefsStore((state) => state.setNearMeTier);
  const homeBaseTier = usePrefsStore((state) => state.homeBaseTier);
  const setHomeBaseTier = usePrefsStore((state) => state.setHomeBaseTier);
  const homeBase = usePrefsStore((state) => state.homeBase);
  const setHomeBase = usePrefsStore((state) => state.setHomeBase);
  const [isPickingTown, setIsPickingTown] = useState(false);

  // `focusPermissionStatus` re-checks on every screen focus (e.g. coming
  // back from the OS Settings app); `override` reflects the immediate
  // result of an in-screen request (tier change / rehearsal button) without
  // waiting for a focus event. Whichever is more recent wins by simply
  // preferring the override once one exists.
  const focusPermissionStatus = useNotificationPermissionStatus();
  const [override, setOverride] = useState<NotificationPermissionStatus | null>(null);
  const permissionStatus = override ?? focusPermissionStatus;

  const [isAlertModalVisible, setIsAlertModalVisible] = useState(false);

  const magnitudeText = t("events.magnitudeDisplay", {
    value: formatMagnitudeValue(REHEARSAL_EXAMPLE_MAGNITUDE, i18n.language),
  });
  const exampleTitle = t("notificationSettings.rehearsal.exampleTitle", {
    magnitude: magnitudeText,
  });
  const exampleBody = t("notificationSettings.rehearsal.exampleBody");

  /** Permission primer per spec-v1.md §4.11: ask only at the value moment
   * — here, moving a tier away from "off" or tapping a rehearsal button
   * that fires a real notification. Never called on screen mount. */
  async function requestPermissionIfNeeded(): Promise<NotificationPermissionStatus> {
    const result = await ensureNotificationPermission();
    setOverride(result);
    return result;
  }

  async function handleNearMeTierChange(tier: NotificationTier) {
    setNearMeTier(tier);
    if (tier !== "off") {
      await requestPermissionIfNeeded();
    }
  }

  async function handleHomeBaseTierChange(tier: NotificationTier) {
    setHomeBaseTier(tier);
    if (tier !== "off") {
      await requestPermissionIfNeeded();
    }
  }

  function handleSelectTown(townId: string) {
    const town = HOME_BASE_TOWNS.find((candidate) => candidate.id === townId);
    if (!town) {
      return;
    }
    setHomeBase({ townId: town.id, lat: town.lat, lon: town.lon });
    setIsPickingTown(false);
  }

  function handleSelectElsewhere() {
    setHomeBase(null);
    setIsPickingTown(false);
  }

  async function handlePlaySound() {
    const result = await requestPermissionIfNeeded();
    if (result !== "granted") {
      // Denial is surfaced by the PermissionDeniedRow above, already
      // visible once `permissionStatus` flips — nothing further to do here.
      return;
    }
    Alert.alert(
      t("notificationSettings.rehearsal.playSoundHintTitle"),
      t("notificationSettings.rehearsal.playSoundHintMessage"),
      [
        {
          text: t("notificationSettings.rehearsal.playSoundHintConfirm"),
          onPress: () => {
            void fireRehearsalNotification(exampleTitle, exampleBody);
          },
        },
      ],
    );
  }

  const currentTown = homeBase
    ? HOME_BASE_TOWNS.find((town) => town.id === homeBase.townId)
    : null;
  const currentTownLabel = currentTown
    ? pickLocalizedName(currentTown.names, i18n.language)
    : t("onboarding.homeBase.notSet");

  return (
    <>
      <Stack.Screen
        options={{
          title: t("notificationSettings.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        style={{ backgroundColor: colors.surface.base }}
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: spacing[5],
            paddingBottom: insets.bottom + spacing[8],
            paddingStart: spacing[5],
            paddingEnd: spacing[5],
            gap: spacing[6],
          },
        ]}
      >
        {permissionStatus === "denied" ? <PermissionDeniedRow /> : null}

        {/* Near Me section */}
        <View style={{ gap: spacing[2] }}>
          <Text
            accessibilityRole="header"
            style={{
              color: colors.text.primary,
              fontSize: typography.h2.fontSize,
              lineHeight: typography.h2.lineHeight,
              fontWeight: typography.h2.fontWeight,
            }}
          >
            {t("notificationSettings.nearMe.title")}
          </Text>
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {t("notificationSettings.nearMe.explainer")}
          </Text>
          <TierSelector
            value={nearMeTier}
            onChange={(tier) => void handleNearMeTierChange(tier)}
          />
        </View>

        {/* HomeBase section */}
        <View style={{ gap: spacing[2] }}>
          <Text
            accessibilityRole="header"
            style={{
              color: colors.text.primary,
              fontSize: typography.h2.fontSize,
              lineHeight: typography.h2.lineHeight,
              fontWeight: typography.h2.fontWeight,
            }}
          >
            {t("notificationSettings.homeBase.title")}
          </Text>
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {t("notificationSettings.homeBase.explainer")}
          </Text>

          <View style={styles.spaceBetweenRow}>
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                fontWeight: "600",
              }}
            >
              {currentTownLabel}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsPickingTown((value) => !value)}
              hitSlop={12}
            >
              <Text
                style={{
                  color: colors.text.link,
                  fontSize: typography.labelButton.fontSize,
                  fontWeight: typography.labelButton.fontWeight,
                }}
              >
                {t("notificationSettings.homeBase.change")}
              </Text>
            </Pressable>
          </View>
          {isPickingTown ? (
            <TownPicker
              selectedTownId={homeBase?.townId ?? HOME_BASE_ELSEWHERE_ID}
              onSelectTown={handleSelectTown}
              onSelectElsewhere={handleSelectElsewhere}
            />
          ) : null}

          {homeBase === null ? (
            <Text
              style={{
                color: colors.text.tertiary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
              }}
            >
              {t("notificationSettings.homeBase.notSetHint")}
            </Text>
          ) : null}

          <TierSelector
            value={homeBaseTier}
            onChange={(tier) => void handleHomeBaseTierChange(tier)}
            disabled={homeBase === null}
          />
        </View>

        {/* Rehearsal */}
        <View style={{ gap: spacing[2] }}>
          <Text
            accessibilityRole="header"
            style={{
              color: colors.text.primary,
              fontSize: typography.h2.fontSize,
              lineHeight: typography.h2.lineHeight,
              fontWeight: typography.h2.fontWeight,
            }}
          >
            {t("notificationSettings.rehearsal.title")}
          </Text>
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {t("notificationSettings.rehearsal.description")}
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => setIsAlertModalVisible(true)}
            style={[
              styles.row,
              { borderColor: colors.border.default, paddingVertical: spacing[3] },
            ]}
          >
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                fontWeight: "600",
              }}
            >
              {t("notificationSettings.rehearsal.seeAlert")}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => void handlePlaySound()}
            style={[
              styles.row,
              { borderColor: colors.border.default, paddingVertical: spacing[3] },
            ]}
          >
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                fontWeight: "600",
              }}
            >
              {t("notificationSettings.rehearsal.playSound")}
            </Text>
          </Pressable>
        </View>

        <Text
          style={{
            color: colors.text.tertiary,
            fontSize: typography.labelCaption.fontSize,
            lineHeight: typography.labelCaption.lineHeight,
          }}
        >
          {t("notificationSettings.fatigueFooter")}
        </Text>
      </ScrollView>

      <RehearsalAlertModal
        visible={isAlertModalVisible}
        onClose={() => setIsAlertModalVisible(false)}
        titleText={exampleTitle}
        bodyText={exampleBody}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
  },
  row: {
    borderWidth: 1,
    borderRadius: 10,
    paddingStart: 16,
    paddingEnd: 16,
    alignItems: "center",
  },
  spaceBetweenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
