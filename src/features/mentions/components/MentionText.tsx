import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { profileHref } from "@/features/community/routes";
import { isolateNumeric } from "@/features/events";
import { useTheme } from "@/theme";
import { mentionCandidates, resolveMention, splitMentions } from "../parse";
import { useKnownMentions } from "../queries";
import type { MentionsTransport } from "../transport";

interface MentionTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  numberOfLines?: number;
  /** Test seam. */
  transport?: MentionsTransport;
}

/**
 * A comment's or post's text with every @username that belongs to an
 * account turned into a link to that profile (`/u/username`); a name that
 * matches nobody stays plain text. The link is kept left-to-right inside
 * Sorani or Arabic text (a directional isolate), so "@shirin" never flips or
 * swallows the punctuation around it. Nothing is asked of the server when
 * the text has no "@".
 */
export function MentionText({
  text,
  style,
  testID,
  numberOfLines,
  transport,
}: MentionTextProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const segments = useMemo(() => splitMentions(text), [text]);
  const names = useMemo(() => mentionCandidates(segments), [segments]);
  const known = useKnownMentions(names, transport);

  if (names.length === 0) {
    return (
      <Text style={style} testID={testID} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }

  return (
    <Text style={style} testID={testID} numberOfLines={numberOfLines}>
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return segment.text;
        }
        const { username, linkText, rest } = resolveMention(segment, known);
        if (username === null) {
          return segment.raw;
        }
        return [
          <Text
            key={`m${index}`}
            accessibilityRole="link"
            accessibilityLabel={t("mentions.openProfile", { username })}
            onPress={() => router.push(profileHref(username))}
            style={{ color: colors.text.link, fontWeight: "600" }}
            testID={`mention-link-${username}`}
          >
            {isolateNumeric(linkText)}
          </Text>,
          rest,
        ];
      })}
    </Text>
  );
}
