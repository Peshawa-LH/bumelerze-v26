import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { PersonRow } from "@/features/community/components/PersonRow";
import { isolateNumeric } from "@/features/events/format";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";
import { usePeopleSearch } from "../queries";
import { PEOPLE_SEARCH_LIMIT, PEOPLE_SEARCH_MIN } from "../query";
import type { PeopleSearchTransport } from "../transport";

/**
 * Profile > Find people: a search box that lists people as you type a name
 * or @username (2 letters or more, people you follow first, 8 at most), each
 * row opening that person's profile. It opens from the magnifier in the
 * Profile tab's top bar and sits in the page flow, so it reads the same left
 * to right and right to left. Works for guests too (their anonymous session).
 */
export function PeopleSearch({
  onClose,
  transport,
}: {
  onClose: () => void;
  /** Test seam. */
  transport?: PeopleSearchTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [text, setText] = useState("");
  const result = usePeopleSearch(text, transport);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    fontFamily: nativeFontFamily(typography.bodyMeta),
    ...READING_START,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  let body: ReactNode;
  if (result.status === "short") {
    body = (
      <Text style={meta} testID="people-search-hint">
        {t("peopleSearch.hint", {
          min: localizeDigits(String(PEOPLE_SEARCH_MIN), i18n.language),
        })}
      </Text>
    );
  } else if (result.status === "loading") {
    body = (
      <Text style={meta} testID="people-search-loading">
        {t("peopleSearch.searching")}
      </Text>
    );
  } else if (result.status === "error") {
    body = (
      <View style={[styles.line, { gap: spacing[2] }]}>
        <Text
          accessibilityRole="alert"
          style={[meta, styles.flex, { color: colors.status.danger }]}
          testID="people-search-error"
        >
          {t("peopleSearch.error")}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={result.retry}
          style={styles.button}
          testID="people-search-retry"
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontFamily: nativeFontFamily(typography.labelButton),
              ...READING_START,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("events.retry")}
          </Text>
        </Pressable>
      </View>
    );
  } else if (result.people.length === 0) {
    body = (
      <Text style={meta} testID="people-search-none">
        {t("peopleSearch.none")}
      </Text>
    );
  } else {
    body = (
      <View testID="people-search-results">
        {result.people.map((person) => (
          <View key={person.userId} testID={`people-search-result-${person.username}`}>
            <PersonRow
              person={{
                userId: person.userId,
                username: person.username,
                // No display name: the handle is the name (and gives the
                // photo its initial); the @username line stays under it.
                displayName: person.displayName ?? person.username,
                avatarPath: person.avatarPath,
                roles: [],
              }}
              trailing={
                person.relation !== "other" ? (
                  <Text style={meta}>{t(`mentions.relation.${person.relation}`)}</Text>
                ) : null
              }
            />
          </View>
        ))}
        {result.people.length >= PEOPLE_SEARCH_LIMIT ? (
          <Text style={meta} testID="people-search-more">
            {t("peopleSearch.more", {
              number: isolateNumeric(
                localizeDigits(String(PEOPLE_SEARCH_LIMIT), i18n.language),
              ),
            })}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View
      testID="people-search"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[2],
        },
      ]}
    >
      <View style={[styles.line, { gap: spacing[2] }]}>
        <Ionicons name="search-outline" size={20} color={colors.text.secondary} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t("peopleSearch.placeholder")}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={t("peopleSearch.label")}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          maxLength={40}
          style={[
            styles.input,
            {
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
              fontFamily: nativeFontFamily(typography.bodyDefault),
              // A name in Sorani or a Latin @username: each reads in its
              // own direction (as in the comment box).
              textAlign: "auto",
            },
          ]}
          testID="people-search-input"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("peopleSearch.close")}
          onPress={onClose}
          style={styles.button}
          testID="people-search-close"
        >
          <Ionicons name="close" size={22} color={colors.text.secondary} />
        </Pressable>
      </View>
      <View accessibilityLiveRegion="polite">{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14 },
  line: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1 },
  input: { flex: 1, minHeight: 44, paddingVertical: 8 },
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
