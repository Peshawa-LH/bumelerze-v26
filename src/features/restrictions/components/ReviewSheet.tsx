import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountButton } from "@/features/account/components/AccountButton";
import { communityErrorText } from "@/features/community/error-text";
import { useTheme } from "@/theme";

export const REVIEW_MESSAGE_MAX = 1000;

/**
 * "Ask for review": a short sheet with an optional message and a Send button.
 * It only collects the words; the caller sends them. A failed send keeps the
 * sheet open with the reason in plain words, so nothing typed is lost.
 */
export function ReviewSheet({
  onSend,
  onClose,
}: {
  onSend: (message: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setErrorText(null);
    try {
      await onSend(message.trim());
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      testID="review-sheet-modal"
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          testID="review-sheet-scrim"
          accessibilityRole="button"
          accessibilityLabel={t("eventHub.thread.cancel")}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface.overlay }]}
        />
        <View
          testID="review-sheet"
          style={[
            styles.panel,
            {
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
              padding: spacing[5],
              paddingBottom: spacing[5] + insets.bottom,
              gap: spacing[3],
            },
          ]}
        >
          <View style={styles.titleRow}>
            <Text
              accessibilityRole="header"
              style={[typography.h3, styles.title, { color: colors.text.primary }]}
            >
              {t("restrictions.review.title")}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("eventHub.thread.cancel")}
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
              testID="review-sheet-close"
            >
              <Ionicons name="close" size={24} color={colors.text.primary} />
            </Pressable>
          </View>
          <Text style={[typography.bodyDefault, { color: colors.text.secondary }]}>
            {t("restrictions.review.hint")}
          </Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={t("restrictions.review.placeholder")}
            placeholderTextColor={colors.text.tertiary}
            accessibilityLabel={t("restrictions.review.label")}
            multiline
            maxLength={REVIEW_MESSAGE_MAX}
            editable={!busy}
            textAlignVertical="top"
            style={[
              styles.input,
              {
                color: colors.text.primary,
                borderColor: colors.border.default,
                backgroundColor: colors.surface.base,
                fontSize: typography.bodyDefault.fontSize,
                padding: spacing[3],
                textAlign: "auto",
              },
            ]}
            testID="review-sheet-input"
          />
          {errorText ? (
            <Text
              accessibilityRole="alert"
              style={{
                color: colors.status.danger,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
              }}
              testID="review-sheet-error"
            >
              {errorText}
            </Text>
          ) : null}
          <AccountButton
            label={
              busy ? t("restrictions.review.sending") : t("restrictions.review.send")
            }
            tone="primary"
            disabled={busy}
            onPress={() => void send()}
            testID="review-sheet-send"
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  panel: {
    width: "100%",
    maxWidth: 560,
    borderTopStartRadius: 16,
    borderTopEndRadius: 16,
    borderWidth: 1,
  },
  titleRow: { flexDirection: "row", alignItems: "center" },
  title: { flex: 1 },
  close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 12 },
});
