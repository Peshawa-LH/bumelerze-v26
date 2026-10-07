import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import { RoleMark } from "@/features/eventhub/components/RoleMark";
import { useTheme } from "@/theme";
import { profileHref } from "../routes";
import type { Person } from "../types";
import { formatUsername } from "../username";

/** One person in a list: photo, name, rank mark, @username. The whole row
 * opens their profile when they have a username; `trailing` holds actions. */
export function PersonRow({
  person,
  trailing,
  testID,
}: {
  person: Person;
  trailing?: ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const name = person.displayName || t("eventHub.thread.anonymous");

  const body = (
    <>
      <Avatar
        uri={getAvatarUrl(person.avatarPath)}
        name={person.displayName}
        size={40}
        testID={`person-avatar-${person.userId}`}
      />
      <View style={styles.text}>
        <View style={[styles.nameRow, { gap: spacing[2] }]}>
          <Text
            numberOfLines={1}
            style={[typography.bodyDefault, styles.name, { color: colors.text.primary }]}
          >
            {name}
          </Text>
          <RoleMark roles={person.roles} />
        </View>
        {person.username ? (
          <Text
            numberOfLines={1}
            style={[
              typography.bodyMeta,
              {
                color: colors.text.secondary,
                writingDirection: "ltr",
                textAlign: "left",
              },
            ]}
          >
            {formatUsername(person.username)}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <View style={[styles.row, { gap: spacing[2] }]} testID={testID}>
      {person.username ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("community.openProfile", { name })}
          onPress={() => router.push(profileHref(person.username as string))}
          style={[styles.main, { gap: spacing[3] }]}
          testID={`person-open-${person.userId}`}
        >
          {body}
        </Pressable>
      ) : (
        <View style={[styles.main, { gap: spacing[3] }]}>{body}</View>
      )}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", minHeight: 56 },
  main: { flex: 1, flexDirection: "row", alignItems: "center", minHeight: 56 },
  text: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center" },
  name: { flexShrink: 1, fontWeight: "600" },
});
