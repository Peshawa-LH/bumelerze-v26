import { Stack } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import {
  gazetteerPlaceById,
  placeDetailLine,
  placeDisplayName,
  usePlaceIndex,
  type Place,
} from "@/features/geo";
import { PlaceSearch } from "@/features/geo/components/PlaceSearch";
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
import { usePrefsStore, type NotificationTier } from "@/features/onboarding";
import { confirmDialog } from "@/lib/dialogs";
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
  const anotherPlaceTier = usePrefsStore((state) => state.anotherPlaceTier);
  const setAnotherPlaceTier = usePrefsStore((state) => state.setAnotherPlaceTier);
  const anotherPlace = usePrefsStore((state) => state.anotherPlace);
  const setAnotherPlace = usePrefsStore((state) => state.setAnotherPlace);
  const placeIndex = usePlaceIndex();
  const [isPickingPlace, setIsPickingPlace] = useState(false);

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

  async function handleAnotherPlaceTierChange(tier: NotificationTier) {
    setAnotherPlaceTier(tier);
    if (tier !== "off") {
      await requestPermissionIfNeeded();
    }
  }

  async function handleSelectPlace(place: Place) {
    setAnotherPlace({ placeId: place.id, lat: place.lat, lon: place.lon });
    setIsPickingPlace(false);
    // A new place starts at "all": the value moment for the permission ask.
    await requestPermissionIfNeeded();
  }

  function handleRemovePlace() {
    setAnotherPlace(null);
    setIsPickingPlace(false);
  }

  async function handlePlaySound() {
    const result = await requestPermissionIfNeeded();
    if (result !== "granted") {
      // Denial is surfaced by the PermissionDeniedRow above, already
      // visible once `permissionStatus` flips — nothing further to do here.
      return;
    }
    confirmDialog({
      title: t("notificationSettings.rehearsal.playSoundHintTitle"),
      message: t("notificationSettings.rehearsal.playSoundHintMessage"),
      confirmLabel: t("notificationSettings.rehearsal.playSoundHintConfirm"),
      onConfirm: () => {
        void fireRehearsalNotification(exampleTitle, exampleBody);
      },
    });
  }

  const currentPlace: Place | null = anotherPlace
    ? (placeIndex?.byId.get(anotherPlace.placeId) ??
      gazetteerPlaceById(anotherPlace.placeId) ?? {
        id: anotherPlace.placeId,
        kind: "town",
        lat: anotherPlace.lat,
        lon: anotherPlace.lon,
        names: {},
      })
    : null;

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

        {/* Another place: optional, off until a place is chosen */}
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
            {t("notificationSettings.anotherPlace.title")}
          </Text>
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {t("notificationSettings.anotherPlace.explainer")}
          </Text>

          {currentPlace ? (
            <>
              <View style={styles.spaceBetweenRow}>
                <View style={styles.placeText}>
                  <Text
                    testID="another-place-name"
                    style={{
                      color: colors.text.primary,
                      fontSize: typography.bodyDefault.fontSize,
                      fontWeight: "600",
                    }}
                  >
                    {placeDisplayName(currentPlace, i18n.language)}
                  </Text>
                  <Text
                    style={{
                      color: colors.text.tertiary,
                      fontSize: typography.labelCaption.fontSize,
                    }}
                  >
                    {placeDetailLine(currentPlace, i18n.language, t)}
                  </Text>
                </View>
                <View style={styles.linkRow}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setIsPickingPlace((value) => !value)}
                    hitSlop={12}
                    style={styles.linkTarget}
                    testID="another-place-change"
                  >
                    <Text
                      style={{
                        color: colors.text.link,
                        fontSize: typography.labelButton.fontSize,
                        fontWeight: typography.labelButton.fontWeight,
                      }}
                    >
                      {t("notificationSettings.anotherPlace.change")}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleRemovePlace}
                    hitSlop={12}
                    style={styles.linkTarget}
                    testID="another-place-remove"
                  >
                    <Text
                      style={{
                        color: colors.text.link,
                        fontSize: typography.labelButton.fontSize,
                        fontWeight: typography.labelButton.fontWeight,
                      }}
                    >
                      {t("notificationSettings.anotherPlace.remove")}
                    </Text>
                  </Pressable>
                </View>
              </View>
              {isPickingPlace ? (
                <PlaceSearch
                  selectedPlaceId={anotherPlace?.placeId ?? null}
                  onSelect={(place) => void handleSelectPlace(place)}
                  testID="another-place-search"
                />
              ) : null}
              <TierSelector
                value={anotherPlaceTier}
                onChange={(tier) => void handleAnotherPlaceTierChange(tier)}
              />
            </>
          ) : isPickingPlace ? (
            <PlaceSearch
              onSelect={(place) => void handleSelectPlace(place)}
              testID="another-place-search"
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsPickingPlace(true)}
              style={[
                styles.row,
                { borderColor: colors.border.default, paddingVertical: spacing[3] },
              ]}
              testID="another-place-choose"
            >
              <Text
                style={{
                  color: colors.text.primary,
                  fontSize: typography.bodyDefault.fontSize,
                  fontWeight: "600",
                }}
              >
                {t("notificationSettings.anotherPlace.choose")}
              </Text>
            </Pressable>
          )}
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
    gap: 12,
  },
  placeText: { flex: 1 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  linkTarget: { minHeight: 44, justifyContent: "center" },
});
