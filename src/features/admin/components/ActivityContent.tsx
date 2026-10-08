import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { communityErrorText } from "@/features/community/error-text";
import {
  SupabaseCommunityTransport,
  type CommunityTransport,
} from "@/features/community/transport";
import {
  formatUsername,
  isValidUsername,
  normalizeUsername,
} from "@/features/community/username";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { useTheme } from "@/theme";
import { useAdminAccess, useAdminActivity } from "../queries";
import type { AdminTransport } from "../transport";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_FILTER_ACTIONS,
  type ActivityEntry,
  type ActivityFilters,
} from "../types";
import { ActivityRow } from "./ActivityRow";

interface PersonFilter {
  userId: string;
  label: string;
}

/** Admin > Activity: who did what, when and why (migration 0052). Filter by
 * action and by person; 50 rows a page with "Load more". Moderators see content
 * actions only, the official rank sees everything: the server decides, the
 * chips just follow. Read-only for now. */
export function ActivityContent({
  transport,
  hubTransport,
  communityTransport = SupabaseCommunityTransport,
}: {
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
  communityTransport?: CommunityTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const access = useAdminAccess(hubTransport);

  const [action, setAction] = useState<string | null>(null);
  const [person, setPerson] = useState<PersonFilter | null>(null);
  const [username, setUsername] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const filters: ActivityFilters = { action, targetUserId: person?.userId ?? null };
  const activity = useAdminActivity(filters, access.canAudit, transport);
  const rows: ActivityEntry[] = (activity.data?.pages ?? []).flat();

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const name = normalizeUsername(username);
  const chips = ACTIVITY_FILTER_ACTIONS.filter((candidate) =>
    access.canAuditAll
      ? true
      : ACTIVITY_ACTIONS.some((a) => a.action === candidate && a.content),
  );

  async function findPerson() {
    setLooking(true);
    setLookupError(null);
    try {
      const profile = await communityTransport.fetchPublicProfile(name);
      if (!profile) {
        setLookupError(t("admin.activity.personNotFound"));
        return;
      }
      setPerson({ userId: profile.userId, label: formatUsername(profile.username) });
      setUsername("");
    } catch (error) {
      setLookupError(communityErrorText(t, error));
    } finally {
      setLooking(false);
    }
  }

  function filterByEntryPerson(entry: ActivityEntry) {
    if (!entry.targetUserId) {
      return;
    }
    setPerson({
      userId: entry.targetUserId,
      label:
        entry.targetUsername !== null
          ? formatUsername(entry.targetUsername)
          : (entry.targetName ?? t("eventHub.thread.anonymous")),
    });
  }

  if (!access.canAudit) {
    return access.isLoading ? null : (
      <View style={{ padding: spacing[4] }}>
        <Text style={meta} testID="activity-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      testID="admin-activity"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[3],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      <Text style={meta}>{t("admin.activity.hint")}</Text>

      <View style={styles.chips} accessibilityRole="radiogroup">
        <ActionButton
          label={t("admin.activity.allActions")}
          selected={action === null}
          onPress={() => setAction(null)}
          testID="activity-filter-all"
        />
        {chips.map((candidate) => (
          <ActionButton
            key={candidate}
            label={t(`admin.activity.actions.${candidate}`)}
            selected={action === candidate}
            onPress={() => setAction(candidate)}
            testID={`activity-filter-${candidate}`}
          />
        ))}
      </View>

      {person ? (
        <View style={styles.chips}>
          <Text style={meta} testID="activity-person-chip">
            {t("admin.activity.personFilter", { name: person.label })}
          </Text>
          <ActionButton
            label={t("admin.activity.personClear")}
            onPress={() => setPerson(null)}
            testID="activity-person-clear"
          />
        </View>
      ) : (
        <View style={[styles.chips, { gap: spacing[2] }]}>
          <TextInput
            value={username}
            onChangeText={(value) => {
              setUsername(value);
              setLookupError(null);
            }}
            placeholder={t("admin.activity.personPlaceholder")}
            accessibilityLabel={t("admin.activity.personLabel")}
            autoCapitalize="none"
            autoCorrect={false}
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
            testID="activity-person-input"
          />
          <ActionButton
            label={t("admin.activity.personApply")}
            disabled={!isValidUsername(name) || looking}
            onPress={() => void findPerson()}
            testID="activity-person-apply"
          />
        </View>
      )}
      {lookupError ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
          {lookupError}
        </Text>
      ) : null}

      {activity.isLoading ? (
        <Text style={meta} testID="activity-loading">
          {t("eventDetail.loading")}
        </Text>
      ) : activity.isError ? (
        <View style={{ gap: spacing[1] }}>
          <Text
            accessibilityRole="alert"
            style={[meta, { color: colors.status.danger }]}
            testID="activity-error"
          >
            {communityErrorText(t, activity.error)}
          </Text>
          <ActionButton
            label={t("events.retry")}
            onPress={() => void activity.refetch()}
            testID="activity-retry"
          />
        </View>
      ) : rows.length === 0 ? (
        <Text style={meta} testID="activity-empty">
          {t("admin.activity.empty")}
        </Text>
      ) : (
        rows.map((entry) => (
          <ActivityRow key={entry.id} entry={entry} onFilterPerson={filterByEntryPerson} />
        ))
      )}

      {activity.hasNextPage ? (
        <ActionButton
          label={
            activity.isFetchingNextPage
              ? t("eventDetail.loading")
              : t("admin.activity.loadMore")
          }
          disabled={activity.isFetchingNextPage}
          onPress={() => void activity.fetchNextPage()}
          testID="activity-load-more"
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  input: {
    minHeight: 44,
    minWidth: 160,
    borderWidth: 1,
    borderRadius: 8,
    flexShrink: 1,
  },
});
