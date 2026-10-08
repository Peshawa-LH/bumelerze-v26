import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { Sheet } from "@/features/admin/people/components/Sheet";
import { isolateNumeric } from "@/features/events";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import {
  REPORT_NOTE_MAX,
  cleanNote,
  reasonsFor,
  type ReportInput,
  type ReportKind,
  type ReportReason,
} from "./reasons";

interface ReportSheetProps {
  /** Which list of reasons: impersonation is offered for profiles only. */
  kind: ReportKind;
  /** Sends the report. Reject with anything; `errorText` words it. */
  onSubmit: (input: ReportInput) => Promise<void>;
  /** Called after a successful send, before the sheet closes. */
  onSent?: () => void;
  onClose: () => void;
  /** Words a failure for the reader. */
  errorText?: (error: unknown) => string;
  testID?: string;
}

/**
 * The one report dialog for comments, posts and profiles (P1-10): pick the
 * closest reason, optionally add a note of up to 200 characters, send. Nothing
 * is sent until a reason is chosen; the sheet stays open with a message when
 * the send fails so the reader can try again.
 */
export function ReportSheet({
  kind,
  onSubmit,
  onSent,
  onClose,
  errorText,
  testID = "report-sheet",
}: ReportSheetProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  async function submit() {
    if (!reason || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ reason, note: cleanNote(note) });
      onSent?.();
      onClose();
    } catch (caught) {
      setError(errorText ? errorText(caught) : t("report.error"));
      setBusy(false);
    }
  }

  const used = isolateNumeric(localizeDigits(String(note.length), i18n.language));
  const max = isolateNumeric(localizeDigits(String(REPORT_NOTE_MAX), i18n.language));

  return (
    <Sheet
      title={t(`report.title.${kind}`)}
      subtitle={t("report.hint")}
      onClose={onClose}
      testID={testID}
    >
      <View
        accessibilityRole="radiogroup"
        style={{ gap: spacing[1] }}
        testID={`${testID}-reasons`}
      >
        {reasonsFor(kind).map((option) => {
          const selected = option === reason;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: busy }}
              accessibilityLabel={t(`report.reasons.${option}`)}
              disabled={busy}
              onPress={() => setReason(option)}
              testID={`${testID}-reason-${option}`}
              style={[
                styles.option,
                {
                  borderColor: selected ? colors.brand.primary : colors.border.default,
                  backgroundColor: selected ? colors.surface.sunken : "transparent",
                  paddingHorizontal: spacing[3],
                  gap: spacing[3],
                },
              ]}
            >
              <View
                style={[
                  styles.radio,
                  { borderColor: selected ? colors.brand.primary : colors.text.tertiary },
                ]}
              >
                {selected ? (
                  <View style={[styles.dot, { backgroundColor: colors.brand.primary }]} />
                ) : null}
              </View>
              <Text
                style={{
                  flex: 1,
                  color: colors.text.primary,
                  fontSize: typography.bodyDefault.fontSize,
                  lineHeight: typography.bodyDefault.lineHeight,
                  fontWeight: selected ? "600" : "400",
                }}
              >
                {t(`report.reasons.${option}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: spacing[1] }}>
        <Text style={meta}>{t("report.noteLabel")}</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          maxLength={REPORT_NOTE_MAX}
          multiline
          editable={!busy}
          textAlignVertical="top"
          placeholder={t("report.notePlaceholder")}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("report.noteLabel")}
          testID={`${testID}-note`}
          style={[
            styles.note,
            {
              color: colors.text.primary,
              borderColor: colors.border.default,
              backgroundColor: colors.surface.raised,
              fontSize: typography.bodyDefault.fontSize,
              padding: spacing[3],
              textAlign: "auto",
            },
          ]}
        />
        <Text style={[meta, { alignSelf: "flex-end" }]} testID={`${testID}-count`}>
          {t("report.noteCount", { used, max })}
        </Text>
      </View>

      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.status.danger, fontSize: typography.bodyMeta.fontSize }}
          testID={`${testID}-error`}
        >
          {error}
        </Text>
      ) : null}

      <AccountButton
        tone="destructive"
        label={busy ? t("report.sending") : t("report.submit")}
        disabled={!reason || busy}
        onPress={() => void submit()}
        testID={`${testID}-submit`}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  note: { minHeight: 72, borderWidth: 1, borderRadius: 12 },
});
