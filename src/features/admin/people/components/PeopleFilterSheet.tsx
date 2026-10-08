import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { HUB_ROLE_KINDS, type HubRoleKind } from "@/features/eventhub/types";
import { toAsciiDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import {
  NO_FILTERS,
  PEOPLE_PLATFORMS,
  PEOPLE_STATUSES,
  type PeopleFilters,
} from "../types";
import { Sheet } from "./Sheet";

/** "2026-09-30" (Latin or Eastern Arabic-Indic digits) -> the start or end of
 * that local day as an ISO timestamp, or null when it is not a real date. */
export function parseDay(text: string, endOfDay: boolean): string | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(toAsciiDigits(text.trim()));
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59)
    : new Date(year, month - 1, day, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.toISOString();
}

function dayText(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Filters of the directory: rank, status, reported, joined range, recent
 * activity, platform and (for those who may reset passwords) has-a-password.
 * Nothing is sent until "Show". */
export function PeopleFilterSheet({
  filters,
  canFilterPassword,
  onApply,
  onClose,
}: {
  filters: PeopleFilters;
  canFilterPassword: boolean;
  onApply: (filters: PeopleFilters) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [draft, setDraft] = useState<PeopleFilters>(filters);
  const [from, setFrom] = useState(dayText(filters.joinedFrom));
  const [to, setTo] = useState(dayText(filters.joinedTo));
  const fromIso = from.trim() === "" ? null : parseDay(from, false);
  const toIso = to.trim() === "" ? null : parseDay(to, true);
  const dateProblem =
    (from.trim() !== "" && fromIso === null) ||
    (to.trim() !== "" && toIso === null) ||
    (fromIso !== null && toIso !== null && fromIso > toIso);

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
      writingDirection: "ltr" as const,
      textAlign: "left" as const,
    },
  ];
  const set = <K extends keyof PeopleFilters>(key: K, value: PeopleFilters[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const heading = (key: string) => (
    <Text accessibilityRole="header" style={[typography.labelButton, { color: colors.text.primary }]}>
      {t(key)}
    </Text>
  );
  const ranks: (HubRoleKind | "any")[] = ["any", ...HUB_ROLE_KINDS];

  return (
    <Sheet title={t("admin.people.filters.title")} onClose={onClose} testID="people-filter-sheet">
      {heading("admin.people.filters.rank")}
      <View style={styles.chips} accessibilityRole="radiogroup">
        <ActionButton
          label={t("admin.people.filters.all")}
          selected={draft.rank === null}
          onPress={() => set("rank", null)}
          testID="filter-rank-all"
        />
        {ranks.map((rank) => (
          <ActionButton
            key={rank}
            label={rank === "any" ? t("admin.people.filters.anyRank") : t(`eventHub.roles.${rank}`)}
            selected={draft.rank === rank}
            onPress={() => set("rank", rank)}
            testID={`filter-rank-${rank}`}
          />
        ))}
      </View>

      {heading("admin.people.filters.status")}
      <View style={styles.chips} accessibilityRole="radiogroup">
        <ActionButton
          label={t("admin.people.filters.all")}
          selected={draft.status === null}
          onPress={() => set("status", null)}
          testID="filter-status-all"
        />
        {PEOPLE_STATUSES.map((status) => (
          <ActionButton
            key={status}
            label={t(`admin.people.status.${status}`)}
            selected={draft.status === status}
            onPress={() => set("status", status)}
            testID={`filter-status-${status}`}
          />
        ))}
      </View>

      <View style={styles.chips}>
        <ActionButton
          label={t("admin.people.filters.reported")}
          selected={draft.reported}
          onPress={() => set("reported", !draft.reported)}
          testID="filter-reported"
        />
      </View>

      {heading("admin.people.filters.joined")}
      <TextInput
        value={from}
        onChangeText={setFrom}
        placeholder={t("admin.people.filters.from")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("admin.people.filters.from")}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        style={input}
        testID="filter-joined-from"
      />
      <TextInput
        value={to}
        onChangeText={setTo}
        placeholder={t("admin.people.filters.to")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("admin.people.filters.to")}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        style={input}
        testID="filter-joined-to"
      />
      {dateProblem ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID="filter-date-error"
        >
          {t("admin.people.filters.dateInvalid")}
        </Text>
      ) : null}

      {heading("admin.people.filters.active")}
      <View style={styles.chips} accessibilityRole="radiogroup">
        <ActionButton
          label={t("admin.people.filters.all")}
          selected={draft.activeDays === null}
          onPress={() => set("activeDays", null)}
          testID="filter-active-all"
        />
        {([7, 30] as const).map((days) => (
          <ActionButton
            key={days}
            label={t(`admin.people.filters.days${days}`)}
            selected={draft.activeDays === days}
            onPress={() => set("activeDays", days)}
            testID={`filter-active-${days}`}
          />
        ))}
      </View>

      {heading("admin.people.filters.platform")}
      <View style={styles.chips} accessibilityRole="radiogroup">
        <ActionButton
          label={t("admin.people.filters.all")}
          selected={draft.platform === null}
          onPress={() => set("platform", null)}
          testID="filter-platform-all"
        />
        {PEOPLE_PLATFORMS.map((platform) => (
          <ActionButton
            key={platform}
            label={t(`admin.people.platforms.${platform}`)}
            selected={draft.platform === platform}
            onPress={() => set("platform", platform)}
            testID={`filter-platform-${platform}`}
          />
        ))}
      </View>

      {canFilterPassword ? (
        <>
          {heading("admin.people.filters.password")}
          <View style={styles.chips} accessibilityRole="radiogroup">
            <ActionButton
              label={t("admin.people.filters.all")}
              selected={draft.hasPassword === null}
              onPress={() => set("hasPassword", null)}
              testID="filter-password-all"
            />
            <ActionButton
              label={t("admin.people.filters.hasPassword")}
              selected={draft.hasPassword === true}
              onPress={() => set("hasPassword", true)}
              testID="filter-password-yes"
            />
            <ActionButton
              label={t("admin.people.filters.noPassword")}
              selected={draft.hasPassword === false}
              onPress={() => set("hasPassword", false)}
              testID="filter-password-no"
            />
          </View>
        </>
      ) : null}

      <AccountButton
        label={t("admin.people.filters.apply")}
        tone="primary"
        disabled={dateProblem}
        onPress={() => {
          onApply({ ...draft, joinedFrom: fromIso, joinedTo: toIso });
          onClose();
        }}
        testID="filter-apply"
      />
      <AccountButton
        label={t("admin.people.filters.clear")}
        onPress={() => {
          onApply(NO_FILTERS);
          onClose();
        }}
        testID="filter-clear"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 8 },
});
