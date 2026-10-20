import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAccount } from "@/features/account/use-account";
import { communityErrorText } from "@/features/community/error-text";
import {
  isGuidelinesDeclined,
  useGuidelinesGate,
  type GuidelinesTransport,
} from "@/features/guidelines";
import { EVENT_POST_MAX_LENGTH } from "@/features/posts/constants";
import { usePostActions } from "@/features/posts/queries";
import type { PostsTransport } from "@/features/posts/transport";
import { validateEventPostText } from "@/features/posts/validation";
import { localizeDigits } from "@/lib/format-numbers";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useTheme, nativeFontFamily } from "@/theme";

import { ShareActionButton } from "./ShareActionButton";

export interface PostToProfileActionProps {
  /** The event's `bml` id (or registry id); the option hides without one. */
  eventRef: string | null;
  /** The sheet's caption, as edited: it becomes the post's words. */
  caption: string;
  transport?: PostsTransport;
  guidelinesTransport?: GuidelinesTransport;
}

/**
 * "Post to my profile", the fourth option of the share sheet (review notes
 * 2.1 and 4.2): the earthquake goes on my profile as a card, with the
 * sheet's caption as its words. Only for an account with a @username (a
 * public profile to post on); hidden for guests. The person's own location
 * is never attached: the post carries the event reference and the text only.
 */
export function PostToProfileAction(props: PostToProfileActionProps) {
  const account = useAccount();
  const canPost =
    isSupabaseConfigured() &&
    props.eventRef !== null &&
    account.status === "account" &&
    Boolean(account.profile?.username);
  // The posting hooks need the query client; mount them only when shown.
  return canPost ? <PostToProfileInner {...props} /> : null;
}

function PostToProfileInner({
  eventRef,
  caption,
  transport,
  guidelinesTransport,
}: PostToProfileActionProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const actions = usePostActions(transport);
  const { guard, sheet } = useGuidelinesGate(guidelinesTransport);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    if (busy || done || eventRef === null) {
      return;
    }
    setError(null);
    const text = caption.trim();
    if (validateEventPostText(text) === "too_long") {
      setError(
        t("posts.composer.tooLong", {
          max: localizeDigits(String(EVENT_POST_MAX_LENGTH), i18n.language),
        }),
      );
      return;
    }
    setBusy(true);
    try {
      await guard(() => actions.shareEvent(eventRef, text));
      setDone(true);
    } catch (caught) {
      if (!isGuidelinesDeclined(caught)) {
        setError(communityErrorText(t, caught));
      }
    } finally {
      setBusy(false);
    }
  }

  const meta = {
    fontSize: typography.labelCaption.fontSize,
    fontFamily: nativeFontFamily(typography.labelCaption, "400"),
    lineHeight: typography.labelCaption.lineHeight,
  } as const;

  return (
    <View>
      <ShareActionButton
        testID="share-post-profile"
        label={t("share.postToProfile")}
        icon="person-circle-outline"
        busy={busy}
        disabled={busy || done}
        onPress={() => void post()}
      />
      {done ? (
        <Text
          accessibilityLiveRegion="polite"
          testID="share-post-profile-done"
          style={[meta, { color: colors.text.secondary, marginTop: 6 }]}
        >
          {t("share.postedToProfile")}
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          testID="share-post-profile-error"
          style={[meta, { color: colors.status.danger, marginTop: 6 }]}
        >
          {error}
        </Text>
      ) : null}
      {/* nested: iOS cannot present a second modal beside an open one */}
      {sheet}
    </View>
  );
}
