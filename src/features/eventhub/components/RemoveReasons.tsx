import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { FLAG_REASONS, type FlagReason } from "../types";
import { ActionButton } from "./ActionButton";

/** "Why remove it?": the same five reasons readers can report with. The
 * choice becomes the reason in the moderation log; the caller then asks for
 * the final confirmation. */
export function RemoveReasons({
  onSelect,
  onCancel,
  disabled = false,
  testID,
}: {
  onSelect: (reason: FlagReason) => void;
  onCancel: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing[1] }} testID={testID}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("eventHub.thread.removeReasonTitle")}
      </Text>
      <View style={[styles.actions, { gap: spacing[1] }]}>
        {FLAG_REASONS.map((reason) => (
          <ActionButton
            key={reason}
            label={t(`eventHub.reasons.${reason}`)}
            disabled={disabled}
            onPress={() => onSelect(reason)}
            testID={`remove-reason-${reason}`}
          />
        ))}
        <ActionButton label={t("eventHub.thread.cancel")} onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
});
