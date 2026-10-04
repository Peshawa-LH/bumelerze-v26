import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { deleteAccount } from "../service";
import { useAccountAction } from "../use-account-action";
import { AccountButton } from "./AccountButton";

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

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center" },
  confirmBox: { borderWidth: 1, borderRadius: 12 },
});
