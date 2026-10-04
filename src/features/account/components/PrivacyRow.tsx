import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { isolateNumeric } from "@/features/events/format";
import { formatContributorId } from "@/features/mydata/format";
import { useContributorId } from "@/features/mydata/use-contributor-id";
import { useTheme } from "@/theme";
import { SettingsRow, SettingsRowBody } from "./SettingsRow";

const COPIED_MS = 2000;

/** "Privacy & data", collapsed by default. Open: the contributor ID (plumbing,
 * so it lives here, not in the header) with a copy button and one line, plus
 * the account's email when signed in. */
export function PrivacyRow({ email }: { email: string | null }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const deviceId = useContributorId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idText = deviceId ? formatContributorId(deviceId) : null;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copyId() {
    if (!idText) return;
    try {
      await Clipboard.setStringAsync(idText);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Clipboard unavailable: the ID is still selectable text.
    }
  }

  return (
    <View>
      <SettingsRow
        icon="shield-outline"
        label={t("myData.privacy.title")}
        trailing="expand"
        expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
        testID="account-privacy-row"
      />
      {expanded ? (
        <SettingsRowBody>
          <View testID="privacy-details" style={{ gap: spacing[2] }}>
            <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
              {t("myData.privacy.id")}
            </Text>
            <View style={[styles.idRow, { gap: spacing[2] }]}>
              <Text
                selectable
                testID="contributor-id"
                style={[
                  styles.idText,
                  {
                    color: colors.text.primary,
                    writingDirection: "ltr",
                  },
                ]}
              >
                {idText ? isolateNumeric(idText) : "…"}
              </Text>
              <Pressable
                testID="contributor-id-copy"
                accessibilityRole="button"
                accessibilityLabel={t("myData.privacy.copy")}
                disabled={idText === null}
                onPress={() => void copyId()}
                style={({ pressed }) => [
                  styles.copy,
                  { backgroundColor: pressed ? colors.surface.sunken : "transparent" },
                ]}
              >
                <Ionicons name="copy-outline" size={22} color={colors.text.secondary} />
              </Pressable>
              {copied ? (
                <Text
                  testID="contributor-id-copied"
                  accessibilityLiveRegion="polite"
                  style={[typography.bodyMeta, { color: colors.status.success }]}
                >
                  {t("myData.privacy.copied")}
                </Text>
              ) : null}
            </View>
            <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
              {t("myData.privacy.idNote")}
            </Text>
          </View>
          {email ? (
            <View style={{ gap: spacing[1] }}>
              <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>
                {t("myData.privacy.email")}
              </Text>
              <Text
                selectable
                testID="account-email"
                style={[
                  typography.bodyDefault,
                  {
                    color: colors.text.primary,
                    textAlign: "auto",
                    writingDirection: "ltr",
                  },
                ]}
              >
                {email}
              </Text>
            </View>
          ) : null}
        </SettingsRowBody>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  idRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  idText: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
  copy: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
