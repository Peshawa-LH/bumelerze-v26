import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { Sheet } from "@/features/admin/people/components/Sheet";
import { useTheme } from "@/theme";
import { GUIDELINE_RULES, type GuidelinesSource } from "../constants";
import { SupabaseGuidelinesTransport, type GuidelinesTransport } from "../transport";

interface GuidelinesSheetProps {
  /** "accept" asks for the age tick and "I agree"; "read" only shows the rules. */
  mode: "accept" | "read";
  /** Called after the acceptance was stored. */
  onAccepted?: () => void;
  onClose: () => void;
  source?: GuidelinesSource;
  transport?: GuidelinesTransport;
  testID?: string;
}

/**
 * The community guidelines: five short rules, the age tick ("I am 13 or
 * older") and "I agree". Shown before a first comment or post (the server
 * refuses with `guidelines_required` until it was accepted) and, read-only,
 * from Settings. The wording is in the locale files (drafts, owner reviews).
 */
export function GuidelinesSheet({
  mode,
  onAccepted,
  onClose,
  source = "prompt",
  transport = SupabaseGuidelinesTransport,
  testID = "guidelines-sheet",
}: GuidelinesSheetProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [ageOk, setAgeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  async function agree() {
    if (!ageOk || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await transport.accept(source);
      onAccepted?.();
    } catch {
      setError(t("guidelines.error"));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t("guidelines.title")}
      subtitle={t("guidelines.intro")}
      onClose={onClose}
      testID={testID}
    >
      <View style={{ gap: spacing[3] }}>
        {GUIDELINE_RULES.map((rule) => (
          <View key={rule} style={{ gap: spacing[1] }} testID={`${testID}-rule-${rule}`}>
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
                fontWeight: "700",
              }}
            >
              {t(`guidelines.rules.${rule}.title`)}
            </Text>
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
              }}
            >
              {t(`guidelines.rules.${rule}.body`)}
            </Text>
          </View>
        ))}
        <Text style={meta}>{t("guidelines.consequence")}</Text>
      </View>

      {mode === "accept" ? (
        <>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ageOk, disabled: busy }}
            accessibilityLabel={t("guidelines.age")}
            disabled={busy}
            onPress={() => setAgeOk((value) => !value)}
            testID={`${testID}-age`}
            style={[styles.checkRow, { gap: spacing[3] }]}
          >
            <View
              style={[
                styles.box,
                {
                  borderColor: ageOk ? colors.brand.primary : colors.text.tertiary,
                  backgroundColor: ageOk ? colors.brand.primary : "transparent",
                },
              ]}
            >
              {ageOk ? (
                <Ionicons name="checkmark" size={18} color={colors.brand.onPrimary} />
              ) : null}
            </View>
            <Text
              style={{
                flex: 1,
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
              }}
            >
              {t("guidelines.age")}
            </Text>
          </Pressable>

          {error ? (
            <Text
              accessibilityRole="alert"
              style={{
                color: colors.status.danger,
                fontSize: typography.bodyMeta.fontSize,
              }}
              testID={`${testID}-error`}
            >
              {error}
            </Text>
          ) : null}

          <AccountButton
            tone="primary"
            label={busy ? t("guidelines.agreeing") : t("guidelines.agree")}
            disabled={!ageOk || busy}
            onPress={() => void agree()}
            testID={`${testID}-agree`}
          />
          <AccountButton
            label={t("guidelines.notNow")}
            disabled={busy}
            onPress={onClose}
            testID={`${testID}-later`}
          />
        </>
      ) : (
        <AccountButton
          label={t("guidelines.close")}
          onPress={onClose}
          testID={`${testID}-close-button`}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  checkRow: { minHeight: 48, flexDirection: "row", alignItems: "center" },
  box: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
