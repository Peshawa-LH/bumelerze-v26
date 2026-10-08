import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { communityErrorText } from "@/features/community/error-text";
import { ProfileLink } from "@/features/community/components/ProfileLink";
import {
  formatUsername,
  isValidUsername,
  normalizeUsername,
} from "@/features/community/username";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { RoleMark } from "@/features/eventhub/components/RoleMark";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme } from "@/theme";
import { useAdminActions, useRoleHolders } from "../queries";
import type { EventHubTransport } from "@/features/eventhub/transport";
import type { AdminTransport } from "../transport";
import { GRANTABLE_RANKS, type GrantableRank } from "../types";

/** Give or take away a rank badge by @username, and see who holds which. */
export function RankBadgesSection({
  transport,
  hubTransport,
}: {
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const holders = useRoleHolders(true, transport);
  const actions = useAdminActions(transport, hubTransport);
  const [username, setUsername] = useState("");
  const [rank, setRank] = useState<GrantableRank>("engineer");
  const [org, setOrg] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const name = normalizeUsername(username);
  const ready = isValidUsername(name);
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
      backgroundColor: colors.surface.raised,
      fontSize: typography.bodyDefault.fontSize,
      paddingHorizontal: spacing[3],
    },
  ];

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setErrorText(null);
    setResultText(null);
    try {
      await action();
      setResultText(done);
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing[3] }} testID="admin-ranks">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("admin.ranks.title")}
      </Text>

      <View style={{ gap: spacing[2] }}>
        <Text style={[meta, { fontWeight: "600" }]}>
          {t("admin.ranks.usernameLabel")}
        </Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="username"
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("admin.ranks.usernameLabel")}
          style={[input, { writingDirection: "ltr", textAlign: "left" }]}
          testID="admin-username-input"
        />

        <Text style={[meta, { fontWeight: "600" }]}>{t("admin.ranks.rankLabel")}</Text>
        <View style={[styles.chips, { gap: spacing[2] }]} accessibilityRole="radiogroup">
          {GRANTABLE_RANKS.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: rank === value, checked: rank === value }}
              onPress={() => setRank(value)}
              testID={`admin-rank-${value}`}
              style={[
                styles.chip,
                {
                  borderColor:
                    rank === value ? colors.brand.primary : colors.border.default,
                  backgroundColor:
                    rank === value ? colors.brand.primary : colors.surface.raised,
                  paddingHorizontal: spacing[3],
                },
              ]}
            >
              <Text
                style={{
                  color: rank === value ? colors.brand.onPrimary : colors.text.primary,
                  fontSize: typography.bodyMeta.fontSize,
                  fontWeight: "600",
                }}
              >
                {t(`eventHub.roles.${value}`)}
              </Text>
            </Pressable>
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
            style={[input, { textAlign: "auto" }]}
            testID="admin-org-input"
          />
        ) : null}
        <TextInput
          value={note}
          onChangeText={setNote}
          maxLength={200}
          placeholder={t("admin.ranks.noteLabel")}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("admin.ranks.noteLabel")}
          style={[input, { textAlign: "auto" }]}
          testID="admin-note-input"
        />

        <AccountButton
          tone="primary"
          label={t("admin.ranks.grant")}
          disabled={!ready || busy}
          onPress={() =>
            void run(
              () =>
                actions.grant({
                  username: name,
                  role: rank,
                  orgName: rank === "partner" ? org : null,
                  note,
                }),
              t("admin.ranks.granted"),
            )
          }
          testID="admin-grant"
        />
        <AccountButton
          tone="destructive"
          label={t("admin.ranks.revoke")}
          disabled={!ready || busy}
          onPress={() =>
            void run(() => actions.revoke(name, rank), t("admin.ranks.revoked"))
          }
          testID="admin-revoke"
        />
        {resultText ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[meta, { color: colors.status.success }]}
          >
            {resultText}
          </Text>
        ) : null}
        {errorText ? (
          <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
            {errorText}
          </Text>
        ) : null}
      </View>

      <Text
        accessibilityRole="header"
        style={[
          typography.bodyDefault,
          { color: colors.text.primary, fontWeight: "600" },
        ]}
      >
        {t("admin.ranks.holders")}
      </Text>
      {(holders.data ?? []).length === 0 ? (
        <Text style={meta}>{t("admin.ranks.noHolders")}</Text>
      ) : (
        (holders.data ?? []).map((holder) => (
          <View
            key={`${holder.userId}-${holder.role}`}
            style={[styles.holder, { gap: spacing[2] }]}
            testID={`holder-${holder.userId}-${holder.role}`}
          >
            <RoleMark
              roles={[{ role: holder.role, orgName: holder.orgName }]}
              size={20}
            />
            <View style={styles.holderText}>
              <ProfileLink
                username={holder.username}
                name={holder.displayName ?? t("eventHub.thread.anonymous")}
                testID={`holder-open-${holder.userId}-${holder.role}`}
              >
                <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>
                  {holder.displayName ?? t("eventHub.thread.anonymous")}
                  {" · "}
                  {t(`eventHub.roles.${holder.role}`)}
                </Text>
                <Text style={[meta, { writingDirection: "ltr", textAlign: "left" }]}>
                  {[
                    holder.username ? formatUsername(holder.username) : null,
                    holder.grantedByName
                      ? `⁨${t("admin.ranks.givenBy", { name: holder.grantedByName })}⁩`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </ProfileLink>
            </View>
            {holder.role !== "official" && holder.username ? (
              <ActionButton
                label={t("admin.ranks.revoke")}
                danger
                onPress={() =>
                  confirmDialog({
                    title: t("admin.ranks.revoke"),
                    message: `${holder.displayName ?? ""} · ${t(`eventHub.roles.${holder.role}`)}`,
                    confirmLabel: t("admin.ranks.revoke"),
                    cancelLabel: t("eventHub.thread.cancel"),
                    destructive: true,
                    onConfirm: () =>
                      void run(
                        () =>
                          actions.revoke(
                            holder.username as string,
                            holder.role as GrantableRank,
                          ),
                        t("admin.ranks.revoked"),
                      ),
                  })
                }
                testID={`holder-revoke-${holder.userId}-${holder.role}`}
              />
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 10, minHeight: 48 },
  chips: { flexDirection: "row", flexWrap: "wrap" },
  chip: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  holder: { flexDirection: "row", alignItems: "center", minHeight: 56 },
  holderText: { flex: 1 },
});
