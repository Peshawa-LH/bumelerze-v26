import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { useTheme } from "@/theme";
import { useAdminActions } from "../../queries";
import type { AdminTransport } from "../../transport";
import { GRANTABLE_RANKS, type GrantableRank } from "../../types";
import { Sheet } from "./Sheet";

/** Give or take away a rank badge for ONE person (the Admin > Rank badges
 * form, with the @username already filled in). */
export function BadgeSheet({
  username,
  name,
  heldRanks,
  onClose,
  transport,
  hubTransport,
}: {
  username: string;
  name: string;
  heldRanks: readonly string[];
  onClose: () => void;
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const actions = useAdminActions(transport, hubTransport);
  const [rank, setRank] = useState<GrantableRank>("engineer");
  const [org, setOrg] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const input = [
    styles.input,
    {
      color: colors.text.primary,
      borderColor: colors.border.default,
      backgroundColor: colors.surface.base,
      fontSize: typography.bodyDefault.fontSize,
      paddingHorizontal: spacing[3],
      textAlign: "auto" as const,
    },
  ];

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    setErrorText(null);
    setDone(null);
    try {
      await action();
      setDone(message);
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t("admin.person.badge.title")}
      subtitle={name}
      onClose={onClose}
      testID="badge-sheet"
    >
      <Text style={meta}>
        {heldRanks.length > 0
          ? t("admin.person.badge.holds", {
              ranks: heldRanks.map((r) => t(`eventHub.roles.${r}`)).join(", "),
            })
          : t("admin.person.badge.holdsNone")}
      </Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {GRANTABLE_RANKS.map((value) => (
          <ActionButton
            key={value}
            label={t(`eventHub.roles.${value}`)}
            selected={rank === value}
            onPress={() => setRank(value)}
            testID={`badge-rank-${value}`}
          />
        ))}
      </View>
      {rank === "partner" ? (
        <TextInput
          value={org}
          onChangeText={setOrg}
          maxLength={80}
          placeholder={t("admin.ranks.orgLabel")}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("admin.ranks.orgLabel")}
          style={input}
          testID="badge-org-input"
        />
      ) : null}
      <TextInput
        value={note}
        onChangeText={setNote}
        maxLength={200}
        placeholder={t("admin.ranks.noteLabel")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("admin.ranks.noteLabel")}
        style={input}
        testID="badge-note-input"
      />
      <AccountButton
        tone="primary"
        label={t("admin.ranks.grant")}
        disabled={busy}
        onPress={() =>
          void run(
            () =>
              actions.grant({
                username,
                role: rank,
                orgName: rank === "partner" ? org : null,
                note,
              }),
            t("admin.ranks.granted"),
          )
        }
        testID="badge-grant"
      />
      <AccountButton
        tone="destructive"
        label={t("admin.ranks.revoke")}
        disabled={busy}
        onPress={() => void run(() => actions.revoke(username, rank), t("admin.ranks.revoked"))}
        testID="badge-revoke"
      />
      {done ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[meta, { color: colors.status.success }]}
          testID="badge-done"
        >
          {done}
        </Text>
      ) : null}
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID="badge-error"
        >
          {errorText}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10 },
});
