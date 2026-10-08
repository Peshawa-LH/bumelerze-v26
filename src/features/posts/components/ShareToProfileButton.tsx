import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useAccount } from "@/features/account/use-account";
import { Sheet } from "@/features/admin/people/components/Sheet";
import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { isolateNumeric } from "@/features/events/format";
import {
  isGuidelinesDeclined,
  useGuidelinesGate,
  type GuidelinesTransport,
} from "@/features/guidelines";
import { localizeDigits } from "@/lib/format-numbers";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useTheme } from "@/theme";
import { EVENT_POST_MAX_LENGTH } from "../constants";
import { usePostActions } from "../queries";
import type { PostsTransport } from "../transport";
import type { PostEvent } from "../types";
import { validateEventPostText } from "../validation";
import { EventPostCard } from "./EventPostCard";

interface ShareToProfileButtonProps {
  /** The event's `bml` id (or internal id); the button hides without one. */
  eventRef: string | null;
  /** What the preview card shows: public event data only. */
  preview: Omit<PostEvent, "ref">;
  transport?: PostsTransport;
  guidelinesTransport?: GuidelinesTransport;
  testID?: string;
}

/**
 * "Share to my profile" (P2-11): puts this earthquake on my profile as a card,
 * with a few optional words ("I felt it in Sulaymaniyah"). Only for a real
 * account with a @username (a public profile to post on). The person's own
 * location is never attached; the sheet says so.
 */
export function ShareToProfileButton({
  eventRef,
  preview,
  transport,
  guidelinesTransport,
  testID = "share-to-profile",
}: ShareToProfileButtonProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const account = useAccount();
  const actions = usePostActions(transport);
  const { guard, sheet } = useGuidelinesGate(guidelinesTransport);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canShare =
    isSupabaseConfigured() &&
    eventRef !== null &&
    account.status === "account" &&
    Boolean(account.profile?.username);
  if (!canShare) {
    return null;
  }

  const locale = i18n.language;
  const problem = validateEventPostText(text);
  const used = localizeDigits(String(text.trim().length), locale);
  const max = localizeDigits(String(EVENT_POST_MAX_LENGTH), locale);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  async function submit() {
    if (problem !== null || busy || eventRef === null) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await guard(() => actions.shareEvent(eventRef, text.trim()));
      setOpen(false);
      setText("");
      setDone(true);
    } catch (caught) {
      if (!isGuidelinesDeclined(caught)) {
        setError(communityErrorText(t, caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing[1] }}>
      <View style={styles.start}>
        <ActionButton
          label={t("posts.share.action")}
          onPress={() => {
            setDone(false);
            setError(null);
            setOpen(true);
          }}
          testID={testID}
        />
      </View>
      {done ? (
        <Text accessibilityLiveRegion="polite" style={meta} testID={`${testID}-done`}>
          {t("posts.share.done")}
        </Text>
      ) : null}
      {open ? (
        <Sheet
          title={t("posts.share.title")}
          onClose={() => setOpen(false)}
          testID={`${testID}-sheet`}
        >
          <EventPostCard
            event={{ ...preview, ref: eventRef }}
            interactive={false}
            testID={`${testID}-preview`}
          />
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            editable={!busy}
            textAlignVertical="top"
            placeholder={t("posts.share.placeholder")}
            placeholderTextColor={colors.text.tertiary}
            accessibilityLabel={t("posts.share.label")}
            testID={`${testID}-input`}
            style={[
              styles.input,
              {
                color: colors.text.primary,
                borderColor:
                  problem === "too_long" ? colors.status.danger : colors.border.default,
                backgroundColor: colors.surface.base,
                fontSize: typography.bodyDefault.fontSize,
                padding: spacing[3],
                textAlign: "auto",
              },
            ]}
          />
          <Text
            style={[
              meta,
              problem === "too_long" ? { color: colors.status.danger } : null,
            ]}
            accessibilityLabel={t("posts.composer.counterA11y", { used, max })}
            testID={`${testID}-counter`}
          >
            {isolateNumeric(`${used}/${max}`)}
          </Text>
          <Text style={meta} testID={`${testID}-privacy`}>
            {t("posts.share.noLocation")}
          </Text>
          {error ? (
            <Text
              accessibilityRole="alert"
              style={[meta, { color: colors.status.danger }]}
              testID={`${testID}-error`}
            >
              {error}
            </Text>
          ) : null}
          <AccountButton
            tone="primary"
            label={busy ? t("posts.composer.posting") : t("posts.share.submit")}
            disabled={busy || problem !== null}
            onPress={() => void submit()}
            testID={`${testID}-submit`}
          />
          {/* nested: iOS cannot present a second modal beside an open one */}
          {sheet}
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  start: { alignItems: "flex-start" },
  input: { minHeight: 88, borderWidth: 1, borderRadius: 12 },
});
