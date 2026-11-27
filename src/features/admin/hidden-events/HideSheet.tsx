import type { TFunction } from "i18next";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { AccountButton } from "@/features/account/components/AccountButton";
import { communityErrorText } from "@/features/community/error-text";
import { formatCount } from "../people/format";
import { Sheet } from "../people/components/Sheet";
import { useTextDir } from "../ui";
import { a11yState } from "@/lib/a11y-state";
import { useTheme } from "@/theme";
import { useCandidateLine } from "./event-line";
import { useHideCandidates, useHideImpact } from "./queries";
import {
  cleanHideNote,
  hideErrorKind,
  HIDE_NOTE_MAX_LENGTH,
  HIDE_REASONS,
  type HiddenEventsAdminTransport,
  type HideFoundEvent,
  type HideImpact,
  type HideInput,
  type HideReason,
} from "./transport";

/** The words for a refusal (`hideErrorKind`): 2.19, 2.20, the generic
 * "Couldn't do that. Try again." when another admin may have acted first,
 * else the shared words ("Not allowed." for not_allowed, as on the Home
 * screen page). */
export function hideErrorText(t: TFunction, error: unknown): string {
  switch (hideErrorKind(error)) {
    case "kept":
      return t("admin.hiddenEvents.errors.keptRequired");
    case "note":
      return t("admin.hiddenEvents.errors.noteRequired");
    case "isKeptCard":
      return t("admin.hiddenEvents.errors.isKeptCard");
    case "stale":
      return t("community.errors.unknown");
    default:
      return communityErrorText(t, error);
  }
}

/** Wording 2.17: "{number} felt reports · {number} "I'm safe" check-ins ·
 * On Home now: hiding takes it off Home" (the last part only when it is). */
export function impactLine(t: TFunction, language: string, impact: HideImpact): string {
  return [
    t("admin.hiddenEvents.impact.feltReports", {
      count: impact.feltReports,
      number: formatCount(impact.feltReports, language),
    }),
    t("admin.hiddenEvents.impact.checkins", {
      count: impact.safetyCheckins,
      number: formatCount(impact.safetyCheckins, language),
    }),
    impact.onHome ? t("admin.hiddenEvents.impact.onHome") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One choice of a vertical radio list: a full-width row at least 48 px
 * tall, its hint under the label. */
function RadioRow({
  label,
  hint,
  selected,
  onPress,
  testID,
}: {
  label: string;
  hint?: string | null;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      {...a11yState({ checked: selected, selected })}
      onPress={onPress}
      testID={testID}
      style={[
        styles.radio,
        {
          borderColor: selected ? colors.brand.primary : colors.border.default,
          borderWidth: selected ? 2 : 1,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
          gap: spacing[3],
        },
      ]}
    >
      <View
        style={[
          styles.dot,
          { borderColor: selected ? colors.brand.primary : colors.text.tertiary },
        ]}
      >
        {selected ? (
          <View style={[styles.dotInner, { backgroundColor: colors.brand.primary }]} />
        ) : null}
      </View>
      <View style={styles.radioText}>
        <Text style={[typography.bodyDefault, dir, { color: colors.text.primary }]}>
          {label}
        </Text>
        {hint ? (
          <Text style={[typography.bodyMeta, dir, { color: colors.text.secondary }]}>
            {hint}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function Group({
  label,
  testID,
  children,
}: {
  label: string;
  testID: string;
  children: ReactNode;
}) {
  const { spacing } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
      style={{ gap: spacing[2] }}
    >
      {children}
    </View>
  );
}

/**
 * "Hide this earthquake for everyone?" (wording 2.10-2.20): why (a second
 * card, not a real earthquake, other), the card that stays for a second
 * card (earthquakes within 10 minutes and 300 km, from the server), a short
 * note (needed for "Other"), what will change, and the button. Checked here
 * first (2.19, 2.20), then on the server.
 */
export function HideSheet({
  event,
  line,
  onClose,
  onHide,
  onStale,
  transport,
}: {
  event: HideFoundEvent;
  line: string;
  onClose: () => void;
  onHide: (input: HideInput) => Promise<unknown>;
  /** Another admin may have acted (already hidden, gone): read the lists
   * again. */
  onStale: () => void;
  transport?: HiddenEventsAdminTransport | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const snackbar = useSnackbar();
  const candidateLine = useCandidateLine();
  const [reason, setReason] = useState<HideReason>("duplicate");
  const [keptEventId, setKeptEventId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const candidates = useHideCandidates(event.eventId, reason === "duplicate", transport);
  const impact = useHideImpact(event.eventId, true, transport);

  const meta = [typography.bodyMeta, dir, { color: colors.text.secondary }];
  const reasonHint: Record<HideReason, string | null> = {
    duplicate: t("admin.hiddenEvents.reasonHints.duplicate"),
    not_real: t("admin.hiddenEvents.reasonHints.not_real"),
    other: null,
  };

  async function hide() {
    const cleanNote = cleanHideNote(note);
    if (reason === "duplicate" && !keptEventId) {
      setErrorText(t("admin.hiddenEvents.errors.keptRequired"));
      return;
    }
    if (reason === "other" && !cleanNote) {
      setErrorText(t("admin.hiddenEvents.errors.noteRequired"));
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      await onHide({
        eventId: event.eventId,
        reason,
        keptEventId: reason === "duplicate" ? keptEventId : null,
        note: cleanNote,
      });
      snackbar.show({ message: t("admin.hiddenEvents.hiddenDone") });
      onClose();
    } catch (error) {
      setErrorText(hideErrorText(t, error));
      if (hideErrorKind(error) === "stale") {
        onStale();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t("admin.hiddenEvents.sheetTitle")}
      subtitle={line}
      onClose={onClose}
      testID={`hide-sheet-${event.eventId}`}
    >
      <Text style={[typography.labelButton, dir, { color: colors.text.primary }]}>
        {t("admin.hiddenEvents.why")}
      </Text>
      <Group label={t("admin.hiddenEvents.why")} testID="hide-reason">
        {HIDE_REASONS.map((value) => (
          <RadioRow
            key={value}
            label={t(`admin.hiddenEvents.reasons.${value}`)}
            hint={reasonHint[value]}
            selected={reason === value}
            onPress={() => {
              setReason(value);
              setErrorText(null);
            }}
            testID={`hide-reason-${value}`}
          />
        ))}
      </Group>

      {reason === "duplicate" ? (
        <View style={{ gap: spacing[2] }} testID="hide-kept">
          <Text style={[typography.labelButton, dir, { color: colors.text.primary }]}>
            {t("admin.hiddenEvents.keptTitle")}
          </Text>
          <Text style={meta}>{t("admin.hiddenEvents.keptHint")}</Text>
          {candidates.isLoading ? (
            <Text style={meta}>{t("eventDetail.loading")}</Text>
          ) : candidates.isError ? (
            <Text
              accessibilityRole="alert"
              style={[meta, { color: colors.status.danger }]}
              testID="hide-kept-error"
            >
              {communityErrorText(t, candidates.error)}
            </Text>
          ) : candidates.data && candidates.data.length === 0 ? (
            <Text style={meta} testID="hide-kept-none">
              {t("admin.hiddenEvents.keptNone")}
            </Text>
          ) : (
            <Group label={t("admin.hiddenEvents.keptTitle")} testID="hide-kept-list">
              {(candidates.data ?? []).map((candidate) => (
                <RadioRow
                  key={candidate.eventId}
                  label={candidateLine(candidate)}
                  selected={keptEventId === candidate.eventId}
                  onPress={() => {
                    setKeptEventId(candidate.eventId);
                    setErrorText(null);
                  }}
                  testID={`hide-kept-${candidate.eventId}`}
                />
              ))}
            </Group>
          )}
        </View>
      ) : null}

      <Text style={meta}>{t("admin.hiddenEvents.noteLabel")}</Text>
      <TextInput
        value={note}
        onChangeText={(value) => {
          setNote(value);
          setErrorText(null);
        }}
        multiline
        maxLength={HIDE_NOTE_MAX_LENGTH}
        accessibilityLabel={t("admin.hiddenEvents.noteLabel")}
        style={[
          styles.note,
          typography.bodyDefault,
          dir,
          {
            color: colors.text.primary,
            borderColor: colors.border.default,
            backgroundColor: colors.surface.base,
            paddingHorizontal: spacing[3],
            paddingVertical: spacing[2],
            textAlign: "auto",
          },
        ]}
        testID="hide-note"
      />

      {impact.data ? (
        <Text style={meta} testID="hide-impact">
          {impactLine(t, i18n.language, impact.data)}
        </Text>
      ) : null}

      {/* Above the button: below it, a long sheet would push it off a phone screen. */}
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID="hide-error"
        >
          {errorText}
        </Text>
      ) : null}
      <AccountButton
        label={t("admin.hiddenEvents.hideButton")}
        tone="destructiveSolid"
        disabled={busy}
        onPress={() => void hide()}
        testID="hide-confirm"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  radio: {
    minHeight: 48,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  radioText: { flex: 1, gap: 2 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dotInner: { width: 10, height: 10, borderRadius: 5 },
  note: { minHeight: 72, borderWidth: 1, borderRadius: 10, textAlignVertical: "top" },
});
