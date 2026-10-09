import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { isGuidelinesDeclined, useGuidelinesGate } from "@/features/guidelines";
import type { GuidelinesTransport } from "@/features/guidelines";
import { MentionSuggestions } from "@/features/mentions/components/MentionSuggestions";
import type { MentionsTransport } from "@/features/mentions/transport";
import { useMentionInput } from "@/features/mentions/use-mention-input";
import { useTheme } from "@/theme";

import { toHubError } from "../transport";
import type { HubErrorCode } from "../types";

export const COMMENT_MAX_LENGTH = 1000;

interface CommentComposerProps {
  /** Signed in with an account: posts show at once. Otherwise comments wait
   * for review, and the composer says so and offers the sign-in link. */
  isAccount: boolean;
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
  /** Replies get a Cancel button. */
  onCancel?: () => void;
  autoFocus?: boolean;
  /** The account is limited (migration 0054): the box and the Post button are
   * off and a short line says why. The banner above explains the details. */
  disabled?: boolean;
  /** Test seam for the guidelines sheet's "I agree" call. */
  guidelinesTransport?: GuidelinesTransport;
  /** Test seam for the @mention suggestions (migration 0063). */
  mentionsTransport?: MentionsTransport;
  /** Characters allowed: 1000 for hub comments, 500 for post comments. */
  maxLength?: number;
  /** Already-localized message for a failure, when the caller knows better
   * words than the hub's (post comments: "Comments are off"). */
  errorText?: (error: unknown) => string | null;
  testID?: string;
}

const ERROR_KEY: Record<HubErrorCode, string> = {
  rate_limited: "eventHub.composer.errors.rateLimited",
  flag_limit: "eventHub.composer.errors.unknown",
  network: "eventHub.composer.errors.network",
  not_signed_in: "eventHub.composer.errors.unknown",
  expired: "eventHub.composer.errors.unknown",
  not_restorable: "eventHub.composer.errors.unknown",
  restricted: "eventHub.composer.errors.restricted",
  guidelines_required: "eventHub.composer.errors.unknown",
  unknown: "eventHub.composer.errors.unknown",
};

/**
 * Multiline comment box with a Post button. The server decides whether the
 * comment is shown at once or held for review; this only mirrors that in the
 * wording (an anonymous reader is told up front, an account is not).
 */
export function CommentComposer({
  isAccount,
  placeholder,
  onSubmit,
  onCancel,
  autoFocus = false,
  disabled = false,
  guidelinesTransport,
  mentionsTransport,
  maxLength = COMMENT_MAX_LENGTH,
  errorText,
  testID = "hub-composer",
}: CommentComposerProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The guidelines are asked for on the first comment: the server refuses
  // until they were accepted, then the same comment is sent again.
  const { guard, sheet } = useGuidelinesGate(guidelinesTransport);
  // "@na…" suggests people; picking one writes "@username " (migration 0063).
  const mention = useMentionInput(text, setText);

  const canPost = text.trim().length > 0 && !busy && !disabled;

  async function handlePost() {
    if (!canPost) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await guard(() => onSubmit(text.trim()));
      setText("");
      setNotice(isAccount ? null : t("eventHub.composer.postedPending"));
      onCancel?.();
    } catch (caught) {
      // Closing the guidelines without agreeing is not an error: the text stays.
      if (!isGuidelinesDeclined(caught)) {
        setError(errorText?.(caught) ?? t(ERROR_KEY[toHubError(caught).code]));
      }
    } finally {
      setBusy(false);
    }
  }

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  return (
    <View style={{ gap: spacing[2] }} testID={testID}>
      <TextInput
        value={text}
        onChangeText={setText}
        onSelectionChange={mention.onSelectionChange}
        placeholder={placeholder}
        placeholderTextColor={colors.text.tertiary}
        accessibilityLabel={t("eventHub.composer.label")}
        multiline
        maxLength={maxLength}
        autoFocus={autoFocus}
        editable={!busy && !disabled}
        textAlignVertical="top"
        style={[
          styles.input,
          {
            color: colors.text.primary,
            borderColor: colors.border.default,
            backgroundColor: colors.surface.raised,
            fontSize: typography.bodyDefault.fontSize,
            padding: spacing[3],
            // Follows the writing direction of what is typed.
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

      {!isAccount ? (
        <View style={{ gap: spacing[1] }}>
          <Text style={meta}>{t("eventHub.composer.anonymousNote")}</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push("/account/sign-in")}
            hitSlop={8}
            style={styles.linkTarget}
          >
            <Text
              style={{
                color: colors.text.link,
                fontSize: typography.labelButton.fontSize,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {t("eventHub.composer.createAccount")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Text
          style={[meta, { color: colors.status.danger }]}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text style={meta} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}

      {sheet}

      <View style={[styles.buttons, { gap: spacing[2] }]}>
        <Pressable
          accessibilityRole="button"
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
            {busy ? t("eventHub.composer.posting") : t("eventHub.composer.post")}
          </Text>
        </Pressable>
        {onCancel ? (
          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            style={[styles.button, { paddingHorizontal: spacing[3] }]}
          >
            <Text
              style={{
                color: colors.text.link,
                fontSize: typography.labelButton.fontSize,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {t("eventHub.thread.cancel")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: 12,
  },
  buttons: {
    flexDirection: "row",
    alignItems: "center",
  },
  button: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  linkTarget: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
});
