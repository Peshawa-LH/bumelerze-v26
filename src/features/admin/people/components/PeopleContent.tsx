import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { useTheme } from "@/theme";
import { useAdminAccess } from "../../queries";
import { formatCount } from "../format";
import { useDebounced, usePeopleSearch } from "../queries";
import type { PeopleTransport } from "../transport";
import {
  MIN_QUERY_LENGTH,
  NO_FILTERS,
  PEOPLE_SORTS,
  countFilters,
  type PeopleFilters,
  type PeopleQuery,
  type PeopleSort,
  type PeopleTab,
} from "../types";
import { PeopleFilterSheet } from "./PeopleFilterSheet";
import { PeopleStatsHeader } from "./PeopleStatsHeader";
import { PersonRowItem } from "./PersonRowItem";

const DEBOUNCE_MS = 350;

/** Admin > People: the numbers, a search box, Accounts / Guests / All tabs
 * (the last two only for `people.view_guests`), filters, a sort, and 50 rows a
 * page with "Load more". Gated by `people.view` inside; a stray link shows
 * nothing. Every number and row comes from the server's fixed-shape answers. */
export function PeopleContent({
  transport,
  hubTransport,
}: {
  transport?: PeopleTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const access = useAdminAccess(hubTransport);
  const [text, setText] = useState("");
  const [tab, setTab] = useState<PeopleTab>("accounts");
  const [filters, setFilters] = useState<PeopleFilters>(NO_FILTERS);
  const [sort, setSort] = useState<PeopleSort>("last_seen");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const debounced = useDebounced(text.trim(), DEBOUNCE_MS);
  const tooShort = debounced.length > 0 && debounced.length < MIN_QUERY_LENGTH;
  const query: PeopleQuery = useMemo(
    () => ({ query: tooShort ? "" : debounced, tab, filters, sort }),
    [debounced, tooShort, tab, filters, sort],
  );
  const search = usePeopleSearch(query, access.canViewPeople && !tooShort, transport);
  const rows = (search.data?.pages ?? []).flatMap((page) => page.rows);
  const idle = search.data?.pages[0]?.idleGuests ?? null;
  const language = i18n.language;
  const filterCount = countFilters(filters);

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (!access.canViewPeople) {
    return access.isLoading ? null : (
      <View style={{ padding: spacing[4] }}>
        <Text style={meta} testID="people-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </View>
    );
  }

  const tabs: PeopleTab[] = access.canViewGuests
    ? ["accounts", "guests", "all"]
    : ["accounts"];

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      testID="admin-people"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[3],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      <PeopleStatsHeader enabled={access.canViewPeople} {...(transport ? { transport } : {})} />

      <Text style={meta}>{t("admin.people.hint")}</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t(
          access.canViewEmail ? "admin.people.searchPlaceholderEmail" : "admin.people.searchPlaceholder",
        )}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("admin.people.searchLabel")}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[
          styles.input,
          {
            color: colors.text.primary,
            borderColor: colors.border.default,
            backgroundColor: colors.surface.raised,
            fontSize: typography.bodyDefault.fontSize,
            paddingHorizontal: spacing[3],
            writingDirection: "ltr",
            textAlign: "left",
          },
        ]}
        testID="people-search-input"
      />
      {tooShort ? (
        <Text style={meta} testID="people-too-short">
          {t("admin.people.tooShort")}
        </Text>
      ) : null}

      {tabs.length > 1 ? (
        <View style={styles.chips} accessibilityRole="radiogroup">
          {tabs.map((candidate) => (
            <ActionButton
              key={candidate}
              label={t(`admin.people.tabs.${candidate}`)}
              selected={tab === candidate}
              onPress={() => setTab(candidate)}
              testID={`people-tab-${candidate}`}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.chips}>
        <ActionButton
          label={
            filterCount > 0
              ? t("admin.people.filters.buttonCount", { count: formatCount(filterCount, language) })
              : t("admin.people.filters.button")
          }
          onPress={() => setFiltersOpen(true)}
          testID="people-filters-button"
        />
        <Text style={meta}>{t("admin.people.sort.label")}</Text>
        {PEOPLE_SORTS.map((candidate) => (
          <ActionButton
            key={candidate}
            label={t(`admin.people.sort.${candidate}`)}
            selected={sort === candidate}
            onPress={() => setSort(candidate)}
            testID={`people-sort-${candidate}`}
          />
        ))}
      </View>
      {filtersOpen ? (
        <PeopleFilterSheet
          filters={filters}
          canFilterPassword={access.canResetPasswords}
          onApply={setFilters}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}

      {search.isLoading && !tooShort ? (
        <Text style={meta} testID="people-loading">
          {t("eventDetail.loading")}
        </Text>
      ) : search.isError ? (
        <View style={{ gap: spacing[1] }}>
          <Text
            accessibilityRole="alert"
            style={[meta, { color: colors.status.danger }]}
            testID="people-error"
          >
            {communityErrorText(t, search.error)}
          </Text>
          <ActionButton
            label={t("events.retry")}
            onPress={() => void search.refetch()}
            testID="people-retry"
          />
        </View>
      ) : rows.length === 0 && !tooShort ? (
        <Text style={meta} testID="people-empty">
          {t("admin.people.empty")}
        </Text>
      ) : (
        rows.map((row) => <PersonRowItem key={row.userId} row={row} />)
      )}

      {idle !== null && idle > 0 ? (
        <Text style={meta} testID="people-idle-guests">
          {t("admin.people.idleGuests", { count: formatCount(idle, language) })}
        </Text>
      ) : null}

      {search.hasNextPage ? (
        <ActionButton
          label={search.isFetchingNextPage ? t("eventDetail.loading") : t("admin.people.loadMore")}
          disabled={search.isFetchingNextPage}
          onPress={() => void search.fetchNextPage()}
          testID="people-load-more"
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10 },
});
