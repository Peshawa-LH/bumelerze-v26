import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { isolateNumeric } from "@/features/events";
import {
  isGuidelinesDeclined,
  useGuidelinesGate,
  type GuidelinesTransport,
} from "@/features/guidelines";
import { MentionSuggestions } from "@/features/mentions/components/MentionSuggestions";
import type { MentionsTransport } from "@/features/mentions/transport";
import { useMentionInput } from "@/features/mentions/use-mention-input";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { POST_MAX_LENGTH } from "../constants";
import { validatePostBody } from "../validation";

interface PostComposerProps {
  onSubmit: (body: string) => Promise<void>;
  /** The account is limited (migration 0054): box and Post button are off. */
  disabled?: boolean;
  /** Test seam for the guidelines sheet's "I agree" call. */
  guidelinesTransport?: GuidelinesTransport;
  /** Test seam for the @mention suggestions (migration 0063). */
  mentionsTransport?: MentionsTransport;
  testID?: string;
}

/**
 * "Write a post": a multiline box, a live character counter (turns red over
 * 500) and a Post button that stays off while the text is empty or too long.
 * The server trims and re-checks everything; this only spares a round trip.
 */
export function PostComposer({
  onSubmit,
  disabled = false,
  guidelinesTransport,
  mentionsTransport,
  testID = "post-composer",
}: PostComposerProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Asked for on the first post: the server refuses until the community
  // guidelines were accepted, then the same post is sent again.
  const { guard, sheet } = useGuidelinesGate(guidelinesTransport);
  const mention = useMentionInput(text, setText);

  const problem = validatePostBody(text);
  const canPost = problem === null && !busy && !disabled;
  const over = text.trim().length > POST_MAX_LENGTH;
  const used = localizeDigits(String(text.trim().length), i18n.language);
  const max = localizeDigits(String(POST_MAX_LENGTH), i18n.language);

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  async function handlePost() {
    if (!canPost) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await guard(() => onSubmit(text.trim()));
      setText("");
    } catch (caught) {
      // Closing the guidelines without agreeing is not an error: the text stays.
      if (!isGuidelinesDeclined(caught)) {
        setError(communityErrorText(t, caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing[2] }} testID={testID}>
      <TextInput
        value={text}
        onChangeText={setText}
        onSelectionChange={mention.onSelectionChange}
        placeholder={t("posts.composer.placeholder")}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("posts.composer.label")}
        multiline
        editable={!busy && !disabled}
        textAlignVertical="top"
        style={[
          styles.input,
          {
            color: colors.text.primary,
            borderColor: over ? colors.status.danger : colors.border.default,
            backgroundColor: colors.surface.raised,
            fontSize: typography.bodyDefault.fontSize,
            padding: spacing[3],
            // Follows the writing direction of what is typed (mixed languages).
            textAlign: "auto",
          },
        ]}
        testID={`${testID}-input`}
      />
      <MentionSuggestions
        query={disabled ? null : mention.query}
        onPick={mention.pick}
        testID={`${testID}-mentions`}
        {...(mentionsTransport ? { transport: mentionsTransport } : {})}
      />
      {disabled ? (
        <Text style={meta} testID={`${testID}-disabled`}>
          {t("restrictions.composerDisabled")}
        </Text>
      ) : null}
      <View style={[styles.footer, { gap: spacing[2] }]}>
        <Text
          accessibilityLabel={t("posts.composer.counterA11y", { used, max })}
          accessibilityLiveRegion="polite"
          testID={`${testID}-counter`}
          style={[meta, over ? { color: colors.status.danger } : null]}
        >
          {isolateNumeric(`${used}/${max}`)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("posts.composer.post")}
          accessibilityState={{ disabled: !canPost, busy }}
          disabled={!canPost}
          onPress={() => void handlePost()}
          testID={`${testID}-post`}
          style={[
            styles.button,
            {
              backgroundColor: canPost ? colors.brand.primary : colors.surface.raised,
              borderColor: canPost ? colors.brand.primary : colors.border.default,
              paddingHorizontal: spacing[5],
            },
          ]}
        >
          <Text
            style={{
              color: canPost ? colors.brand.onPrimary : colors.text.tertiary,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {busy ? t("posts.composer.posting") : t("posts.composer.post")}
          </Text>
        </Pressable>
      </View>
      {sheet}
      {over ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID={`${testID}-too-long`}
        >
          {t("posts.composer.tooLong", { max })}
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID={`${testID}-error`}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 96, borderWidth: 1, borderRadius: 12 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  button: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
