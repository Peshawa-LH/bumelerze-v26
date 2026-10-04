import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

import type { HubRole, HubRoleKind } from "../types";

const ROLE_PRIORITY: readonly HubRoleKind[] = [
  "official",
  "moderator",
  "engineer",
  "partner",
];

const ROLE_ICON: Record<HubRoleKind, keyof typeof Ionicons.glyphMap> = {
  official: "checkmark-circle",
  moderator: "shield-checkmark",
  engineer: "construct",
  partner: "ribbon",
};

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
 * The official account wears the Bumelerze round icon as its tick; the other
 * roles each get their own icon and colour, a first step toward collectable
 * badges. The role's name stays for screen readers.
 */
export function RoleMark({ roles }: { roles: readonly HubRole[] | undefined }) {
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
  const tint: Record<HubRoleKind, string> = {
    official: colors.text.link,
    moderator: colors.text.link,
    engineer: colors.status.warning,
    partner: colors.status.success,
  };

  return (
    <View
      testID={`role-mark-${role.role}`}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={styles.mark}
    >
      {role.role === "official" ? (
        <Image
          source={OFFICIAL_ICON}
          contentFit="contain"
          style={styles.mark}
          testID="role-mark-official-icon"
        />
      ) : (
        <Ionicons name={ROLE_ICON[role.role]} size={MARK_SIZE} color={tint[role.role]} />
      )}
    </View>
  );
}

const MARK_SIZE = 18;
const OFFICIAL_ICON = require("../../../../assets/brand/logo/bumelerze-app-icon-round.svg");

const styles = StyleSheet.create({
  mark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
});
