import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { AccountButton } from "@/features/account/components/AccountButton";
import { ROLE_BADGES } from "@/features/badges/catalog";
import { toneColor } from "@/features/badges/tones";
import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { useTheme } from "@/theme";
import { useAdminActions } from "../../queries";
import type { AdminTransport } from "../../transport";
import { GRANTABLE_RANKS, type GrantableRank } from "../../types";
import { useTextDir } from "../../ui/text-dir";
import { Sheet } from "./Sheet";

/** How long a Government official rank lasts (migration 0082: at most 12
 * months; the official account picks one). */
export const AUTHORITY_TERMS = [3, 6, 12] as const;
export type AuthorityTerm = (typeof AUTHORITY_TERMS)[number];

/** The end of a term that starts now: the same time of day, `months` later. */
export function authorityEndsAt(months: AuthorityTerm, now: number = Date.now()): number {
  const end = new Date(now);
  end.setMonth(end.getMonth() + months);
  return end.getTime();
}

/** The shortest reason the server accepts (migration 0082). */
export const AUTHORITY_REASON_MIN = 5;

/** One-line explanations under the ranks that need one (mockup 5d). */
const DESCRIBED: Partial<Record<GrantableRank, string>> = {
  authority: "admin.person.badge.describe.authority",
  moderator: "admin.person.badge.describe.moderator",
  partner: "admin.person.badge.describe.partner",
};

/**
 * "Give badge to @name" (review 15.1, mockup 5d), opened from a person's
 * page: one radio row per badge an admin may give (Government official
 * first, marked New), badges the person already holds shown as "Has it",
 * the organisation for a partner, a private note only admins see, and one
 * primary button that names the badge. The Government official rank asks
 * for a reason (required, only admins see it) and an end date of 3, 6 or 12
 * months instead (migration 0082: only the official account can give it,
 * with two-step sign-in). Taking a badge away is on the person page, next to
 * each badge held.
 */
export function BadgeSheet({
  username,
  heldRanks,
  onClose,
  transport,
  hubTransport,
}: {
  username: string;
  heldRanks: readonly string[];
  onClose: () => void;
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const snackbar = useSnackbar();
  const actions = useAdminActions(transport, hubTransport);
  const held = (rank: GrantableRank) => heldRanks.includes(rank);
  const [rank, setRank] = useState<GrantableRank | null>(
    GRANTABLE_RANKS.find((r) => !held(r)) ?? null,
  );
  const [org, setOrg] = useState("");
  const [note, setNote] = useState("");
  const [term, setTerm] = useState<AuthorityTerm>(6);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const meta = [typography.bodyMeta, dir, { color: colors.text.secondary }];
  const input = [
    styles.input,
    typography.bodyDefault,
    {
      color: colors.text.primary,
      borderColor: colors.border.default,
      backgroundColor: colors.surface.base,
      paddingHorizontal: spacing[3],
      textAlign: "auto" as const,
    },
  ];

  const isAuthority = rank === "authority";
  const reasonMissing =
    isAuthority && note.trim().length < AUTHORITY_REASON_MIN;

  async function give() {
    if (!rank || reasonMissing) return;
    setBusy(true);
    setErrorText(null);
    try {
      await actions.grant({
        username,
        role: rank,
        orgName: rank === "partner" ? org : null,
        note: isAuthority ? note.trim() : note,
        expiresAt: isAuthority ? authorityEndsAt(term) : null,
      });
      snackbar.show({ message: t("admin.ranks.granted") });
      onClose();
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t("admin.person.badge.giveTitle", { username })}
      onClose={onClose}
      testID="badge-sheet"
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("admin.ranks.rankLabel")}
      >
        {GRANTABLE_RANKS.map((value, index) => {
          const has = held(value);
          const selected = rank === value;
          const badge = ROLE_BADGES[value];
          const name = t(`eventHub.roles.${value}`);
          const key = DESCRIBED[value];
          const describe = key ? t(key) : null;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, selected, disabled: has }}
              accessibilityLabel={[
                name,
                value === "authority" ? t("admin.person.badge.newTag") : null,
                describe,
                has ? t("admin.person.badge.hasIt") : null,
              ]
                .filter(Boolean)
                .join(". ")}
              disabled={has}
              onPress={() => setRank(value)}
              testID={`badge-rank-${value}`}
              style={[
                styles.row,
                {
                  gap: spacing[3],
                  paddingVertical: spacing[2],
                  paddingHorizontal: spacing[2],
                  borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                  borderTopColor: colors.border.subtle,
                  backgroundColor: selected ? colors.surface.sunken : "transparent",
                },
              ]}
            >
              <Ionicons
                name={badge.icon}
                size={22}
                color={toneColor(badge.tone, colors)}
              />
              <View style={styles.text}>
                <View style={[styles.nameRow, { gap: spacing[2] }]}>
                  <Text
                    style={[typography.bodyDefault, dir, { color: colors.text.primary }]}
                  >
                    {name}
                  </Text>
                  {value === "authority" ? (
                    <View
                      style={[
                        styles.tag,
                        {
                          borderColor: colors.brand.primary,
                          paddingHorizontal: spacing[2],
                        },
                      ]}
                    >
                      <Text
                        style={[typography.labelCaption, { color: colors.brand.primary }]}
                      >
                        {t("admin.person.badge.newTag")}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {describe ? <Text style={meta}>{describe}</Text> : null}
              </View>
              {has ? (
                <View style={[styles.nameRow, { gap: 4 }]} testID={`badge-has-${value}`}>
                  <Ionicons name="checkmark" size={18} color={colors.status.success} />
                  <Text
                    style={[typography.labelCaption, { color: colors.status.success }]}
                  >
                    {t("admin.person.badge.hasIt")}
                  </Text>
                </View>
              ) : (
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={22}
                  color={selected ? colors.brand.primary : colors.text.tertiary}
                />
              )}
            </Pressable>
          );
        })}
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
        placeholder={t(
          isAuthority ? "admin.person.badge.reasonLabel" : "admin.person.badge.noteLabel",
        )}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t(
          isAuthority ? "admin.person.badge.reasonLabel" : "admin.person.badge.noteLabel",
        )}
        style={input}
        testID="badge-note-input"
      />
      {isAuthority ? (
        <View style={{ gap: spacing[2] }} testID="badge-term">
          <Text style={meta}>{t("admin.person.badge.endsLabel")}</Text>
          <View
            style={[styles.nameRow, { gap: spacing[2] }]}
            accessibilityRole="radiogroup"
            accessibilityLabel={t("admin.person.badge.endsLabel")}
          >
            {AUTHORITY_TERMS.map((months) => (
              <ActionButton
                key={months}
                label={t(`admin.person.badge.ends.m${months}`)}
                selected={term === months}
                onPress={() => setTerm(months)}
                testID={`badge-term-${months}`}
              />
            ))}
          </View>
        </View>
      ) : null}
      <AccountButton
        tone="primary"
        label={
          rank
            ? t("admin.person.badge.give", { badge: t(`eventHub.roles.${rank}`) })
            : t("admin.person.badge.allHeld")
        }
        disabled={busy || rank === null || reasonMissing}
        onPress={() => void give()}
        testID="badge-grant"
      />
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
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", borderRadius: 10 },
  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  tag: { borderWidth: 1, borderRadius: 999, paddingVertical: 1 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10 },
});
