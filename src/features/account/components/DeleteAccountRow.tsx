import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { deleteAccount } from "../service";
import { useAccountAction } from "../use-account-action";
import { AccountButton } from "./AccountButton";

/** What deleting an account removes and what it leaves, in the order they are
 * shown. Mirrors `delete_my_account()` (migration 0056); the keys are under
 * `myData.account.deleteGoes` and `.deleteStays`. */
export const DELETE_GOES = ["profile", "posts", "comments", "homes", "alerts"] as const;
export const DELETE_STAYS = ["reports", "feedback", "records"] as const;

/** "Delete account": its own card, last on the page, in danger colour with
 * icon AND text. A tap opens the confirmation (warning, solid destructive
 * button, cancel); nothing is deleted before the second tap. */
export function DeleteAccountRow() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { busy, errorText, run } = useAccountAction();
  const [confirming, setConfirming] = useState(false);

  async function confirmDelete() {
    const ok = await run(deleteAccount);
    if (ok) {
      setConfirming(false);
    }
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface.raised, borderColor: colors.border.default },
      ]}
    >
      {confirming ? (
        <View style={{ padding: spacing[4], gap: spacing[3] }}>
          <View
            style={[
              styles.confirmBox,
              { borderColor: colors.status.danger, padding: spacing[3], gap: spacing[3] },
            ]}
          >
            <Text
              accessibilityRole="alert"
              style={[typography.bodyDefault, { color: colors.text.primary }]}
            >
              {t("myData.account.deleteWarning")}
            </Text>
            <ConsequenceList
              title={t("myData.account.deleteGoesTitle")}
              items={DELETE_GOES.map((key) => t(`myData.account.deleteGoes.${key}`))}
              testID="account-delete-goes"
            />
            <ConsequenceList
              title={t("myData.account.deleteStaysTitle")}
              items={DELETE_STAYS.map((key) => t(`myData.account.deleteStays.${key}`))}
              testID="account-delete-stays"
            />
            <AccountButton
              tone="destructiveSolid"
              label={t("myData.account.deleteConfirm")}
              disabled={busy}
              onPress={() => void confirmDelete()}
              testID="account-delete-confirm"
            />
            <AccountButton
              label={t("myData.account.deleteCancel")}
              disabled={busy}
              onPress={() => setConfirming(false)}
              testID="account-delete-cancel"
            />
          </View>
        </View>
      ) : (
        <Pressable
          testID="account-delete"
          accessibilityRole="button"
          accessibilityLabel={t("myData.account.delete")}
          disabled={busy}
          onPress={() => setConfirming(true)}
          style={({ pressed }) => [
            styles.row,
            {
              paddingHorizontal: spacing[4],
              gap: spacing[3],
              backgroundColor: pressed ? colors.surface.sunken : "transparent",
            },
          ]}
        >
          <Ionicons name="trash-outline" size={24} color={colors.status.danger} />
          <Text style={[typography.bodyDefault, { color: colors.status.danger }]}>
            {t("myData.account.delete")}
          </Text>
        </Pressable>
      )}
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={[
            typography.bodyDefault,
            { color: colors.status.danger, padding: spacing[4], paddingTop: 0 },
          ]}
        >
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

/** A heading and a short bulleted list (the dot sits at the start edge in
 * both writing directions). */
function ConsequenceList({
  title,
  items,
  testID,
}: {
  title: string;
  items: string[];
  testID: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing[1] }} testID={testID}>
      <Text
        accessibilityRole="header"
        style={[
          typography.bodyDefault,
          { color: colors.text.primary, fontWeight: "700" },
        ]}
      >
        {title}
      </Text>
      {items.map((item) => (
        <View key={item} style={[styles.bullet, { gap: spacing[2] }]}>
          <View style={[styles.dot, { backgroundColor: colors.text.secondary }]} />
          <Text
            style={{
              flex: 1,
              color: colors.text.primary,
              fontSize: typography.bodyMeta.fontSize,
              lineHeight: typography.bodyMeta.lineHeight,
            }}
          >
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bullet: { flexDirection: "row", alignItems: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  card: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center" },
  confirmBox: { borderWidth: 1, borderRadius: 12 },
});
