import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ROLE_BADGES, ROLE_PRIORITY } from "@/features/badges/catalog";
import { toneColor } from "@/features/badges/tones";
import { useTheme } from "@/theme";

import type { HubRole } from "../types";

/** The role that earns the mark when someone holds several. */
export function pickDisplayRole(roles: readonly HubRole[] | undefined): HubRole | null {
  if (!roles || roles.length === 0) {
    return null;
  }
  for (const kind of ROLE_PRIORITY) {
    const match = roles.find((role) => role.role === kind);
    if (match) {
      return match;
    }
  }
  return null;
}

/**
 * Public role mark next to a name: an icon only, no text (owner, 2026-10-04).
 * It is the top role badge of the shared catalogue (`features/badges`), drawn
 * without the ring: the official account wears the Bumelerze round icon, the
 * other roles each have their own icon and colour. The role's name stays for
 * screen readers. `size` is 18 in comments and 20 beside the account name.
 */
export function RoleMark({
  roles,
  size = 18,
}: {
  roles: readonly HubRole[] | undefined;
  size?: 18 | 20;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const role = pickDisplayRole(roles);
  if (!role) {
    return null;
  }
  const label =
    role.role === "partner" && role.orgName
      ? role.orgName
      : t(`eventHub.roles.${role.role}`);
  const badge = ROLE_BADGES[role.role];
  const box = { width: size, height: size };

  return (
    <View
      testID={`role-mark-${role.role}`}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.mark, box]}
    >
      {badge.image !== null ? (
        <Image
          source={badge.image}
          contentFit="contain"
          style={box}
          testID="role-mark-official-icon"
        />
      ) : (
        <Ionicons name={badge.icon} size={size} color={toneColor(badge.tone, colors)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center" },
});
