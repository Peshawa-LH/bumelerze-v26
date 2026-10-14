import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { AccountButton } from "@/features/account/components/AccountButton";
import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import {
  formatDateOnly,
  formatMagnitudeValue,
  isolateNumeric,
} from "@/features/events/format";
import { useTheme } from "@/theme";
import { Sheet } from "../people/components/Sheet";
import { useAdminAccess } from "../queries";
import { ToolCard, ToolPage, ToolSectionTitle, useTextDir } from "../ui";
import { useHubAdminActions, useHubEvents } from "./queries";
import type { HubAdminTransport, HubEvent } from "./transport";

/** Words for the note errors only this tool can meet; the rest are shared. */
function noteErrorText(t: (key: string) => string, error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("official_account_not_ready")) {
    return t("admin.hubs.errors.officialNotReady");
  }
  if (message.includes("official_account_missing")) {
    return t("admin.hubs.errors.officialMissing");
  }
  return communityErrorText(t as never, error);
}

/**
 * Admin > Open a hub for an earthquake (owner answer 7): the hubs that are
 * open now first, then a search by Bumelerze id or place (or the latest
 * regional earthquakes). Opening keeps a hub open whatever its age; the
 * pinned note is posted as the official Bumelerze account and pinned to the
 * top. The activity log records who did it.
 */
export function HubsContent({
  transport,
  hubTransport,
}: {
  transport?: HubAdminTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const access = useAdminAccess(hubTransport);
  const allowed = access.has("hubs.open");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const list = useHubEvents(query, allowed, transport);
  const actions = useHubAdminActions(transport);
  const snackbar = useSnackbar();
  const [busy, setBusy] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<HubEvent | null>(null);

  // Search as the person types, after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), 350);
    return () => clearTimeout(timer);
  }, [text]);

  const meta = [typography.bodyMeta, dir, { color: colors.text.secondary }];

  if (!allowed) {
    return access.isLoading ? null : (
      <ToolPage testID="hubs-page">
        <Text style={meta} testID="hubs-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </ToolPage>
    );
  }

  async function toggle(event: HubEvent, open: boolean) {
    setBusy(event.eventId);
    setErrorText(null);
    try {
      await actions.setOpen(event.eventId, open);
      snackbar.show({ message: t(open ? "admin.hubs.opened" : "admin.hubs.closed") });
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(null);
    }
  }

  const data = list.data;
  return (
    <ToolPage testID="hubs-page" hint={t("admin.hubs.hint")}>
      <ToolSectionTitle title={t("admin.hubs.openTitle")} testID="hubs-open-title" />
      {data && data.open.length === 0 ? (
        <Text style={meta} testID="hubs-open-empty">
          {t("admin.hubs.openEmpty")}
        </Text>
      ) : null}
      {data?.open.map((event) => (
        <HubEventCard
          key={event.eventId}
          event={event}
          busy={busy === event.eventId}
          onToggle={() => void toggle(event, false)}
          onNote={() => setNoteFor(event)}
        />
      ))}

      <ToolSectionTitle title={t("admin.hubs.findTitle")} />
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t("admin.hubs.searchPlaceholder")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("admin.hubs.searchLabel")}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          typography.bodyDefault,
          {
            color: colors.text.primary,
            borderColor: colors.border.default,
            backgroundColor: colors.surface.raised,
            paddingHorizontal: spacing[3],
            textAlign: "auto",
          },
        ]}
        testID="hubs-search"
      />
      {list.isLoading ? (
        <Text style={meta} testID="hubs-loading">
          {t("eventDetail.loading")}
        </Text>
      ) : list.isError ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID="hubs-error"
        >
          {communityErrorText(t, list.error)}
        </Text>
      ) : data && data.events.length === 0 ? (
        <Text style={meta} testID="hubs-found-empty">
          {query.trim() === "" ? t("admin.hubs.recentEmpty") : t("admin.hubs.noMatch")}
        </Text>
      ) : null}
      {data?.events.map((event) => (
        <HubEventCard
          key={event.eventId}
          event={event}
          busy={busy === event.eventId}
          onToggle={() => void toggle(event, true)}
          onNote={() => setNoteFor(event)}
        />
      ))}
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID="hubs-action-error"
        >
          {errorText}
        </Text>
      ) : null}
      {noteFor ? (
        <NoteSheet
          event={noteFor}
          onClose={() => setNoteFor(null)}
          onPost={(body) => actions.postNote(noteFor.eventId, body)}
        />
      ) : null}
    </ToolPage>
  );
}

/** "M 5.1 · Near Ranya · 1 Oct 2026 · bml2026x01" */
function useEventLine() {
  const { t, i18n } = useTranslation();
  return (event: HubEvent) =>
    [
      event.magnitude !== null
        ? t("admin.hubs.magnitude", {
            value: isolateNumeric(formatMagnitudeValue(event.magnitude, i18n.language)),
          })
        : null,
      event.place,
      formatDateOnly(event.originTime, i18n.language, t),
      event.bumelerzeId ? isolateNumeric(event.bumelerzeId) : null,
    ]
      .filter(Boolean)
      .join(" · ");
}

function HubEventCard({
  event,
  busy,
  onToggle,
  onNote,
}: {
  event: HubEvent;
  busy: boolean;
  onToggle: () => void;
  onNote: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const router = useRouter();
  const line = useEventLine()(event);
  const id = event.bumelerzeId ?? event.eventId;
  return (
    <ToolCard testID={`hub-event-${id}`}>
      <Text style={[typography.bodyDefault, dir, { color: colors.text.primary }]}>
        {line}
      </Text>
      {event.note ? (
        <Text
          style={[typography.bodyMeta, dir, { color: colors.text.secondary }]}
          testID={`hub-note-${id}`}
          numberOfLines={3}
        >
          {t("admin.hubs.pinned", { text: event.note.body })}
        </Text>
      ) : null}
      <View style={[styles.actions, { gap: spacing[2] }]}>
        {event.open ? (
          <AccountButton
            label={t("admin.hubs.writeNote")}
            tone="primary"
            onPress={onNote}
            testID={`hub-write-note-${id}`}
          />
        ) : (
          <AccountButton
            label={t("admin.hubs.open")}
            tone="primary"
            disabled={busy}
            onPress={onToggle}
            testID={`hub-open-${id}`}
          />
        )}
        <View style={[styles.links, { gap: spacing[2] }]}>
          {event.bumelerzeId ? (
            <ActionButton
              label={t("admin.hubs.view")}
              onPress={() => router.push(`/event-hub/${event.bumelerzeId as string}`)}
              testID={`hub-view-${id}`}
            />
          ) : null}
          {event.open ? (
            <ActionButton
              label={t("admin.hubs.close")}
              disabled={busy}
              onPress={onToggle}
              testID={`hub-close-${id}`}
            />
          ) : (
            <ActionButton
              label={t("admin.hubs.writeNote")}
              onPress={onNote}
              testID={`hub-write-note-${id}`}
            />
          )}
        </View>
      </View>
    </ToolCard>
  );
}

function NoteSheet({
  event,
  onClose,
  onPost,
}: {
  event: HubEvent;
  onClose: () => void;
  onPost: (body: string) => Promise<string>;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const snackbar = useSnackbar();
  const line = useEventLine()(event);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const meta = [typography.bodyMeta, { color: colors.text.secondary }];

  async function post() {
    setBusy(true);
    setErrorText(null);
    try {
      await onPost(body.trim());
      snackbar.show({ message: t("admin.hubs.notePosted") });
      onClose();
    } catch (error) {
      setErrorText(noteErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t("admin.hubs.noteTitle")}
      subtitle={line}
      onClose={onClose}
      testID="hub-note-sheet"
    >
      <Text style={meta}>{t("admin.hubs.noteHint")}</Text>
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={1000}
        placeholder={t("admin.hubs.notePlaceholder")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("admin.hubs.noteTitle")}
        style={[
          styles.note,
          typography.bodyDefault,
          {
            color: colors.text.primary,
            borderColor: colors.border.default,
            backgroundColor: colors.surface.base,
            padding: spacing[3],
            textAlign: "auto",
          },
        ]}
        testID="hub-note-input"
      />
      <AccountButton
        label={t("admin.hubs.notePost")}
        tone="primary"
        disabled={busy || body.trim().length === 0}
        onPress={() => void post()}
        testID="hub-note-post"
      />
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID="hub-note-error"
        >
          {errorText}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10 },
  note: { minHeight: 120, borderWidth: 1, borderRadius: 10, textAlignVertical: "top" },
  actions: { gap: 8 },
  links: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
});
