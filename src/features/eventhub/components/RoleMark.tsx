import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ROLE_BADGES, ROLE_PRIORITY } from "@/features/badges/catalog";
import { BumelerzeMark } from "@/features/badges/components/BumelerzeMark";
import { accessibleAccent, toneColor, withAlpha } from "@/features/badges/tones";
import { useTheme } from "@/theme";

import type { HubRole } from "../types";
import { RoleInfoSheet } from "./RoleInfoSheet";

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
 * without the ring: the official account wears the single-colour Bumelerze
 * mark in a small tinted circle (no red, no full logo), the other roles each
 * have their own icon and colour. The role's name stays for
 * screen readers. `size` is 18 in comments and 20 beside the account name.
 * With `explain`, a tap opens "What does this mark mean? Who verified it?"
 * (P2-7); left off inside rows that are themselves one big button.
 */
export function RoleMark({
  roles,
  size = 18,
  explain = false,
}: {
  roles: readonly HubRole[] | undefined;
  size?: 18 | 20;
  explain?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, scheme } = useTheme();
  const [open, setOpen] = useState(false);
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

  const mark = (
    <View
      testID={`role-mark-${role.role}`}
      accessible={!explain}
      accessibilityRole={explain ? undefined : "image"}
      accessibilityLabel={explain ? undefined : label}
      style={[styles.mark, box]}
    >
      {badge.mark ? (
        <View
          testID="role-mark-official-icon"
          style={[
            styles.mark,
            box,
            {
              borderRadius: size / 2,
              backgroundColor: withAlpha(toneColor(badge.tone, colors), 0.16),
            },
          ]}
        >
          <BumelerzeMark
            width={Math.round(size * 0.74)}
            color={accessibleAccent(badge.tone, colors, scheme)}
          />
        </View>
      ) : (
        <Ionicons name={badge.icon} size={size} color={toneColor(badge.tone, colors)} />
      )}
    </View>
  );
  if (!explain) {
    return mark;
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("eventHub.roleInfo.a11y", { role: label })}
        hitSlop={12}
        onPress={() => setOpen(true)}
        testID={`role-mark-button-${role.role}`}
      >
        {mark}
      </Pressable>
      {open ? <RoleInfoSheet role={role} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center" },
});
