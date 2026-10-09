import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import { formatUsername } from "@/features/community/username";
import { useTheme } from "@/theme";
import { useMentionSuggestions } from "../queries";
import type { MentionsTransport } from "../transport";

interface MentionSuggestionsProps {
  /** What follows the "@" being typed, or null. */
  query: string | null;
  onPick: (username: string) => void;
  /** Test seam. */
  transport?: MentionsTransport;
  testID?: string;
}

/**
 * The short list under a comment or post box while an "@name" is being
 * typed: photo, name and @username, at most 8, people the writer follows (or
 * who follow them) first. Tapping one puts "@username " in the text. Nothing
 * shows when nobody matches. A plain list in the page flow (not a floating
 * menu), so it reads the same left-to-right and right-to-left.
 */
export function MentionSuggestions({
  query,
  onPick,
  transport,
  testID = "mention-suggestions",
}: MentionSuggestionsProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const people = useMentionSuggestions(query, transport);
  if (query === null || people.length === 0) {
    return null;
  }
  return (
    <View
      accessibilityLabel={t("mentions.suggestions")}
      testID={testID}
      style={[
        styles.list,
        { borderColor: colors.border.default, backgroundColor: colors.surface.raised },
      ]}
    >
      {people.map((person) => {
        const name = person.displayName ?? formatUsername(person.username);
        return (
          <Pressable
            key={person.userId}
            accessibilityRole="button"
            accessibilityLabel={t("mentions.pick", { name, username: person.username })}
            onPress={() => onPick(person.username)}
            testID={`${testID}-${person.username}`}
            style={[styles.row, { gap: spacing[2], paddingHorizontal: spacing[3] }]}
          >
            <Avatar
              uri={getAvatarUrl(person.avatarPath)}
              name={person.displayName}
              size={28}
            />
            <View style={styles.names}>
              <Text
                numberOfLines={1}
                style={{
                  color: colors.text.primary,
                  fontSize: typography.bodyDefault.fontSize,
                  fontWeight: "600",
                }}
              >
                {name}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  color: colors.text.secondary,
                  fontSize: typography.bodyMeta.fontSize,
                  writingDirection: "ltr",
                  textAlign: "left",
                }}
              >
                {formatUsername(person.username)}
              </Text>
            </View>
            {person.relation !== "other" ? (
              <Text
                style={{
                  color: colors.text.secondary,
                  fontSize: typography.bodyMeta.fontSize,
                }}
              >
                {t(`mentions.relation.${person.relation}`)}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center" },
  names: { flex: 1 },
});
