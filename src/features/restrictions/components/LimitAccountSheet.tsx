import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountButton } from "@/features/account/components/AccountButton";
import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { useTheme } from "@/theme";
import { parseEndDate } from "../date-input";
import { useRestrictionActions } from "../queries";
import type { RestrictionsTransport } from "../transport";
import {
  DURATIONS,
  NOTE_MAX_LENGTH,
  REASON_MAX_LENGTH,
  REASON_PRESETS,
  type DurationId,
  type ReasonPreset,
  type RestrictionLevel,
} from "../types";

export interface LimitTarget {
  userId: string;
  /** Already worded for people, e.g. the display name. */
  name: string;
}

/**
 * Admin sheet "Limit account": level, how long, the reason the person will
 * read, and a private note. A moderator (no `accounts.suspend`) gets warning
 * and restrict for 24 hours or 7 days; the official rank also gets suspend,
 * 30 days, a date of its own and "until lifted" (suspend only). The server
 * enforces the same rules. Done: the sheet closes and a snackbar offers Undo
 * for 10 seconds, which lifts the limit.
 */
export function LimitAccountSheet({
  target,
  canSuspend,
  onClose,
  transport,
}: {
  target: LimitTarget;
  canSuspend: boolean;
  onClose: () => void;
  transport?: RestrictionsTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const actions = useRestrictionActions(transport);
  const showUndo = useUndoToast();

  const [level, setLevel] = useState<RestrictionLevel>("restrict");
  const [duration, setDuration] = useState<DurationId>("d7");
  const [customDate, setCustomDate] = useState("");
  // the typed date as an ISO end of day, or null when it is not a usable date
  const [customEnd, setCustomEnd] = useState<string | null>(null);
  const [preset, setPreset] = useState<ReasonPreset | null>(null);
  const [ownReason, setOwnReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const levels: RestrictionLevel[] = canSuspend
    ? ["warning", "restrict", "suspend"]
    : ["warning", "restrict"];
  const durations: DurationId[] = canSuspend
    ? [
        "h24",
        "d7",
        "d30",
        "custom",
        ...(level === "suspend" ? (["open"] as const) : ([] as const)),
      ]
    : ["h24", "d7"];
  // "until lifted" only exists for a suspension: fall back when the level changes
  const chosenDuration: DurationId =
    duration === "open" && level !== "suspend" ? "d7" : duration;

  const reason = ownReason.trim() !== "" ? ownReason.trim() : (preset ?? "");
  const dateProblem = chosenDuration === "custom" && customEnd === null;
  const canSubmit = reason !== "" && !dateProblem && !busy;

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
      paddingVertical: spacing[2],
      textAlign: "auto" as const,
    },
  ];

  function endsAt(): string | null {
    if (chosenDuration === "open") {
      return null;
    }
    if (chosenDuration === "custom") {
      return customEnd;
    }
    const ms = DURATIONS.find((d) => d.id === chosenDuration)?.ms ?? 0;
    return new Date(Date.now() + ms).toISOString();
  }

  async function submit() {
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      const id = await actions.restrict({
        userId: target.userId,
        level,
        reason,
        note: note.trim() === "" ? null : note.trim(),
        endsAt: endsAt(),
      });
      showUndo({
        message: t(`snackbar.limited.${level}`),
        restore: () => actions.lift(id),
        admin: true,
      });
      onClose();
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  const heading = (key: string) => (
    <Text
      accessibilityRole="header"
      style={[typography.labelButton, { color: colors.text.primary }]}
    >
      {t(key)}
    </Text>
  );

  return (
    <Modal
      testID="limit-sheet-modal"
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          testID="limit-sheet-scrim"
          accessibilityRole="button"
          accessibilityLabel={t("eventHub.thread.cancel")}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface.overlay }]}
        />
        <View
          testID="limit-sheet"
          style={[
            styles.panel,
            {
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
              paddingBottom: insets.bottom,
            },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: spacing[5], gap: spacing[3] }}
          >
            <View style={styles.titleRow}>
              <View style={styles.title}>
                <Text
                  accessibilityRole="header"
                  style={[typography.h3, { color: colors.text.primary }]}
                >
                  {t("restrictions.admin.title")}
                </Text>
                <Text style={meta} testID="limit-sheet-target">
                  {target.name}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("eventHub.thread.cancel")}
                onPress={onClose}
                hitSlop={8}
                style={styles.close}
                testID="limit-sheet-close"
              >
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </Pressable>
            </View>

            {heading("restrictions.admin.levelLabel")}
            <View style={styles.chips} accessibilityRole="radiogroup">
              {levels.map((candidate) => (
                <ActionButton
                  key={candidate}
                  label={t(`restrictions.levels.${candidate}`)}
                  selected={level === candidate}
                  onPress={() => setLevel(candidate)}
                  testID={`limit-level-${candidate}`}
                />
              ))}
            </View>
            <Text style={meta} testID="limit-level-hint">
              {t(`restrictions.admin.levelHints.${level}`)}
            </Text>

            {heading("restrictions.admin.durationLabel")}
            <View style={styles.chips} accessibilityRole="radiogroup">
              {durations.map((candidate) => (
                <ActionButton
                  key={candidate}
                  label={t(`restrictions.admin.durations.${candidate}`)}
                  selected={chosenDuration === candidate}
                  onPress={() => setDuration(candidate)}
                  testID={`limit-duration-${candidate}`}
                />
              ))}
            </View>
            {chosenDuration === "custom" ? (
              <View style={{ gap: spacing[1] }}>
                <TextInput
                  value={customDate}
                  onChangeText={(value) => {
                    setCustomDate(value);
                    setCustomEnd(parseEndDate(value, Date.now()));
                  }}
                  placeholder={t("restrictions.admin.datePlaceholder")}
                  placeholderTextColor={colors.text.tertiary}
                  accessibilityLabel={t("restrictions.admin.dateLabel")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                  style={[input, { writingDirection: "ltr", textAlign: "left" }]}
                  testID="limit-date-input"
                />
                {customDate.trim() !== "" && dateProblem ? (
                  <Text
                    accessibilityRole="alert"
                    style={[meta, { color: colors.status.danger }]}
                    testID="limit-date-error"
                  >
                    {t("restrictions.admin.dateInvalid")}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {heading("restrictions.admin.reasonLabel")}
            <View style={styles.chips} accessibilityRole="radiogroup">
              {REASON_PRESETS.map((candidate) => (
                <ActionButton
                  key={candidate}
                  label={t(`restrictions.reasons.${candidate}`)}
                  selected={preset === candidate && ownReason.trim() === ""}
                  onPress={() => {
                    setPreset(candidate);
                    setOwnReason("");
                  }}
                  testID={`limit-reason-${candidate}`}
                />
              ))}
            </View>
            <TextInput
              value={ownReason}
              onChangeText={setOwnReason}
              placeholder={t("restrictions.admin.reasonOwn")}
              placeholderTextColor={colors.text.tertiary}
              accessibilityLabel={t("restrictions.admin.reasonOwn")}
              maxLength={REASON_MAX_LENGTH}
              style={input}
              testID="limit-reason-input"
            />

            {heading("restrictions.admin.noteLabel")}
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t("restrictions.admin.notePlaceholder")}
              placeholderTextColor={colors.text.tertiary}
              accessibilityLabel={t("restrictions.admin.noteLabel")}
              maxLength={NOTE_MAX_LENGTH}
              multiline
              style={[input, { minHeight: 64 }]}
              testID="limit-note-input"
            />

            {errorText ? (
              <Text
                accessibilityRole="alert"
                style={[meta, { color: colors.status.danger }]}
                testID="limit-error"
              >
                {errorText}
              </Text>
            ) : null}
            <AccountButton
              label={t("restrictions.admin.submit")}
              tone="primary"
              disabled={!canSubmit}
              onPress={() => void submit()}
              testID="limit-submit"
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  panel: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "92%",
    borderTopStartRadius: 16,
    borderTopEndRadius: 16,
    borderWidth: 1,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start" },
  title: { flex: 1 },
  close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 8 },
});
