import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { profileHref } from "../routes";

/** Makes whatever it wraps (a name, a photo, a whole row) open that person's
 * public profile. People without a @username (guests, anonymous sessions)
 * get the children back untouched, so nothing looks tappable that is not.
 * The target is at least 44 pt; private accounts still open their page, which
 * decides what to show. */
export function ProfileLink({
  username,
  name,
  children,
  style,
  testID,
}: {
  username: string | null | undefined;
  /** Shown name, used only for the screen-reader label. */
  name: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  if (!username) {
    return <>{children}</>;
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t("community.openProfile", { name })}
      onPress={() => router.push(profileHref(username))}
      hitSlop={4}
      style={[styles.target, style]}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: { minHeight: 44, justifyContent: "center" },
});
