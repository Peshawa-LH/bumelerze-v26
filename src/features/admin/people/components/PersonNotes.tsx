import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { communityErrorText } from "@/features/community/error-text";
import { formatAbsoluteDual } from "@/features/events";
import { useTheme } from "@/theme";
import { usePeopleActions, usePersonNotes } from "../queries";
import type { PeopleTransport } from "../transport";
import { NOTE_MAX_LENGTH } from "../types";

/** Private notes about a person: only admins with `people.view` read them. */
export function PersonNotes({
  userId,
  transport,
}: {
  userId: string;
  transport?: PeopleTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const notes = usePersonNotes(userId, true, transport);
  const actions = usePeopleActions(transport);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  async function add() {
    setBusy(true);
    setErrorText(null);
    try {
      await actions.addNote(userId, body.trim());
      setBody("");
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing[2] }} testID="person-notes">
      <Text accessibilityRole="header" style={[typography.h3, { color: colors.text.primary }]}>
        {t("admin.person.notes.title")}
      </Text>
      <Text style={meta}>{t("admin.person.notes.hint")}</Text>
      <TextInput
        value={body}
        onChangeText={setBody}
        maxLength={NOTE_MAX_LENGTH}
        multiline
        placeholder={t("admin.person.notes.placeholder")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("admin.person.notes.placeholder")}
        style={[
          styles.input,
          {
            color: colors.text.primary,
            borderColor: colors.border.default,
            backgroundColor: colors.surface.raised,
            fontSize: typography.bodyDefault.fontSize,
            paddingHorizontal: spacing[3],
            paddingVertical: spacing[2],
            textAlign: "auto",
          },
        ]}
        testID="person-note-input"
      />
      <AccountButton
        label={t("admin.person.notes.add")}
        tone="primary"
        disabled={busy || body.trim() === ""}
        onPress={() => void add()}
        testID="person-note-add"
      />
      {errorText ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
          {errorText}
        </Text>
      ) : null}
      {(notes.data ?? []).length === 0 ? (
        <Text style={meta} testID="person-notes-empty">
          {t("admin.person.notes.empty")}
        </Text>
      ) : (
        (notes.data ?? []).map((note) => (
          <View
            key={note.id}
            testID={`person-note-${note.id}`}
            style={[
              styles.note,
              {
                backgroundColor: colors.surface.raised,
                borderColor: colors.border.default,
                padding: spacing[3],
                gap: spacing[1],
              },
            ]}
          >
            <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>{note.body}</Text>
            <Text style={meta}>
              {[
                note.authorName ? t("admin.activity.by", { name: note.authorName }) : null,
                note.createdAt !== null
                  ? formatAbsoluteDual(note.createdAt, i18n.language, t).local
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 64, borderWidth: 1, borderRadius: 10 },
  note: { borderWidth: 1, borderRadius: 12 },
});
