import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { AccountButton } from "@/features/account/components/AccountButton";
import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { hiddenReasonText } from "@/features/eventhub/components/HiddenEventBanner";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { formatDateOnly, isolateLocalizedTime } from "@/features/events/format";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme } from "@/theme";
import { useAdminAccess } from "../queries";
import { ToolCard, ToolPage, ToolSectionTitle, useTextDir } from "../ui";
import { useEventLine } from "./event-line";
import { hideErrorText, HideSheet } from "./HideSheet";
import { useAdminHiddenEvents, useHiddenEventActions, useHideFind } from "./queries";
import {
  hideErrorKind,
  type AdminHiddenEvent,
  type HiddenEventsAdminTransport,
  type HideFoundEvent,
} from "./transport";

/**
 * Admin > Hidden earthquakes (B2.6 stage 2, migration 0085): what is hidden
 * for everyone now, with Show again, then the search to hide another one.
 * Admins only (owner choice 1, `events.hide`). A hidden earthquake leaves
 * Home, Map and Significant on every phone within about 2 minutes; its
 * magnitude and location are never changed. Every change goes to the
 * activity log.
 */
export function HiddenEventsContent({
  transport,
  hubTransport,
}: {
  transport?: HiddenEventsAdminTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const access = useAdminAccess(hubTransport);
  const allowed = access.has("events.hide");
  const list = useAdminHiddenEvents(allowed, transport);
  const actions = useHiddenEventActions(transport);
  const snackbar = useSnackbar();
  const eventLine = useEventLine();

  const [busy, setBusy] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [hideFor, setHideFor] = useState<HideFoundEvent | null>(null);
  const found = useHideFind(query, allowed, transport);

  // Search as the person types, after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const meta = [typography.bodyMeta, dir, { color: colors.text.secondary }];
  const alert = [typography.bodyMeta, dir, { color: colors.status.danger }];

  if (!allowed) {
    return access.isLoading ? null : (
      <ToolPage testID="hidden-events-page">
        <Text style={meta} testID="hidden-events-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </ToolPage>
    );
  }

  const rows = list.data ?? [];

  function hiddenLine(row: AdminHiddenEvent): string {
    return t("admin.hiddenEvents.row", {
      date: isolateLocalizedTime(formatDateOnly(row.hiddenAt, i18n.language, t)),
      reason: hiddenReasonText(t, row),
    });
  }

  async function showAgain(row: AdminHiddenEvent) {
    setBusy(row.eventId);
    setListError(null);
    try {
      await actions.showAgain(row.eventId);
      snackbar.show({ message: t("admin.hiddenEvents.shownAgain") });
    } catch (error) {
      setListError(hideErrorText(t, error));
      if (hideErrorKind(error) === "stale") {
        // Shown again by another admin meanwhile: read the list again.
        actions.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  function askShowAgain(row: AdminHiddenEvent) {
    confirmDialog({
      title: t("admin.hiddenEvents.showAgainTitle"),
      message: t("admin.hiddenEvents.showAgainMessage"),
      confirmLabel: t("admin.hiddenEvents.showAgain"),
      cancelLabel: t("eventHub.thread.cancel"),
      onConfirm: () => void showAgain(row),
    });
  }

  const input = {
    ...typography.bodyDefault,
    color: colors.text.primary,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
    paddingHorizontal: spacing[3],
  };

  return (
    <ToolPage testID="hidden-events-page" hint={t("admin.hiddenEvents.hint")}>
      <ToolSectionTitle
        title={t("admin.hiddenEvents.nowTitle")}
        testID="hidden-events-now"
      />
      {list.isLoading ? (
        <Text style={meta}>{t("eventDetail.loading")}</Text>
      ) : list.isError ? (
        <Text accessibilityRole="alert" style={alert} testID="hidden-events-list-error">
          {communityErrorText(t, list.error)}
        </Text>
      ) : rows.length === 0 ? (
        <Text style={meta} testID="hidden-events-empty">
          {t("admin.hiddenEvents.empty")}
        </Text>
      ) : null}
      {rows.map((row) => (
        <ToolCard key={row.eventId} testID={`hidden-events-row-${row.eventId}`}>
          <Text style={[typography.bodyDefault, dir, { color: colors.text.primary }]}>
            {eventLine(row)}
          </Text>
          <Text style={meta} testID={`hidden-events-why-${row.eventId}`}>
            {hiddenLine(row)}
          </Text>
          <View style={styles.actions}>
            <ActionButton
              label={t("admin.hiddenEvents.showAgain")}
              disabled={busy !== null}
              onPress={() => askShowAgain(row)}
              testID={`hidden-events-show-${row.eventId}`}
            />
          </View>
        </ToolCard>
      ))}
      {listError ? (
        <Text accessibilityRole="alert" style={alert} testID="hidden-events-show-error">
          {listError}
        </Text>
      ) : null}

      <ToolSectionTitle title={t("admin.hubs.findTitle")} />
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={t("admin.hubs.searchPlaceholder")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("admin.hubs.searchLabel")}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.search, input, { textAlign: "auto" }]}
        testID="hidden-events-search"
      />
      {found.isLoading ? (
        <Text style={meta}>{t("eventDetail.loading")}</Text>
      ) : found.isError ? (
        <Text accessibilityRole="alert" style={alert} testID="hidden-events-find-error">
          {communityErrorText(t, found.error)}
        </Text>
      ) : found.data && found.data.length === 0 ? (
        <Text style={meta} testID="hidden-events-found-empty">
          {query.trim() === "" ? t("admin.hubs.recentEmpty") : t("admin.hubs.noMatch")}
        </Text>
      ) : null}
      {found.data?.map((event) => (
        <ToolCard key={event.eventId} testID={`hidden-events-found-${event.eventId}`}>
          <Text style={[typography.bodyDefault, dir, { color: colors.text.primary }]}>
            {eventLine(event)}
          </Text>
          {event.hidden ? (
            <View
              style={[
                styles.mark,
                { borderColor: colors.border.default, paddingHorizontal: spacing[3] },
              ]}
              testID={`hidden-events-mark-${event.eventId}`}
            >
              <Text style={[typography.labelButton, { color: colors.text.secondary }]}>
                {t("admin.hiddenEvents.hiddenMark")}
              </Text>
            </View>
          ) : (
            <AccountButton
              label={t("admin.hiddenEvents.hide")}
              disabled={busy !== null}
              onPress={() => setHideFor(event)}
              testID={`hidden-events-hide-${event.eventId}`}
            />
          )}
        </ToolCard>
      ))}
      {hideFor ? (
        <HideSheet
          event={hideFor}
          line={eventLine(hideFor)}
          onClose={() => setHideFor(null)}
          onHide={actions.hide}
          onStale={actions.refresh}
          transport={transport}
        />
      ) : null}
    </ToolPage>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap" },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 10 },
  mark: {
    alignSelf: "flex-start",
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 16,
    justifyContent: "center",
  },
});
