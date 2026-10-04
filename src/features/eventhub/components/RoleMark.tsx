import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
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
  partner: "checkmark-circle",
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
 * Public role mark next to a name: official = check + "Bumelerze", moderator
 * = shield, engineer = hard-hat style tool, partner = check + organisation.
 */
export function RoleMark({ roles }: { roles: readonly HubRole[] | undefined }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const role = pickDisplayRole(roles);
  if (!role) {
    return null;
  }
  const label =
    role.role === "partner" && role.orgName
      ? role.orgName
      : t(`eventHub.roles.${role.role}`);
  const tint = role.role === "official" ? colors.text.link : colors.text.secondary;

  return (
    <View
      testID={`role-mark-${role.role}`}
      accessible
      accessibilityLabel={label}
      style={[styles.row, { gap: spacing[1] }]}
    >
      <Ionicons name={ROLE_ICON[role.role]} size={16} color={tint} />
      <Text
        style={{
          color: tint,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
          fontWeight: typography.labelCaption.fontWeight,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
});
