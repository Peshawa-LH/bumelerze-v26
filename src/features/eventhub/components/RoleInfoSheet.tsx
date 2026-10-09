import { Ionicons } from "@expo/vector-icons";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";

import type { HubRole } from "../types";

const WIDE_WEB_MIN_WIDTH = 600;

/** Who stands behind each kind of mark (the "Who verified it?" line). */
function verifiedKey(role: HubRole["role"]): string {
  if (role === "official") {
    return "eventHub.roleInfo.verified.official";
  }
  if (role === "moderator") {
    return "eventHub.roleInfo.verified.moderator";
  }
  if (role === "partner") {
    return "eventHub.roleInfo.verified.partner";
  }
  return "eventHub.roleInfo.verified.credential";
}

/**
 * "What does this mark mean? Who verified it?" for a role mark next to a
 * name (review section 4f, P2-7). RN `Modal` like the badge sheet: a bottom
 * panel on the phone, a centred one on a wide web window. Closes with the X,
 * a tap outside, or Android back. Text only; nothing is loaded.
 */
export function RoleInfoSheet({
  role,
  onClose,
}: {
  role: HubRole | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const centered = Platform.OS === "web" && width >= WIDE_WEB_MIN_WIDTH;
  if (!role) {
    return null;
  }
  const name =
    role.role === "partner" && role.orgName
      ? role.orgName
      : t(`eventHub.roles.${role.role}`);
  const meaning =
    role.role === "partner" && role.orgName
      ? t("eventHub.roleInfo.meaning.partnerNamed", { org: role.orgName })
      : t(`eventHub.roleInfo.meaning.${role.role}`);
  const body = {
    color: colors.text.primary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;

  return (
    <Modal
      testID="role-info-modal"
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.root, centered ? styles.rootWeb : styles.rootNative]}>
        <Pressable
          testID="role-info-scrim"
          accessibilityRole="button"
          accessibilityLabel={t("eventHub.roleInfo.close")}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface.overlay }]}
        />
        <View
          testID="role-info-sheet"
          style={[
            styles.panel,
            centered ? styles.panelWeb : styles.panelNative,
            {
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
              padding: spacing[6],
              paddingBottom: spacing[6] + (centered ? 0 : insets.bottom),
              gap: spacing[3],
            },
          ]}
        >
          <Pressable
            testID="role-info-close"
            accessibilityRole="button"
            accessibilityLabel={t("eventHub.roleInfo.close")}
            onPress={onClose}
            style={[styles.close, { top: spacing[2] }]}
          >
            <Ionicons name="close" size={24} color={colors.text.primary} />
          </Pressable>
          <Text
            accessibilityRole="header"
            style={[typography.h3, { color: colors.text.primary, paddingEnd: 40 }]}
          >
            {t("eventHub.roleInfo.title")}
          </Text>
          <Text style={[body, { fontWeight: "600" }]} testID="role-info-name">
            {name}
          </Text>
          <Text style={body} testID="role-info-meaning">
            {meaning}
          </Text>
          <Text style={[typography.h3, { color: colors.text.primary }]}>
            {t("eventHub.roleInfo.verifiedTitle")}
          </Text>
          <Text style={body} testID="role-info-verified">
            {t(verifiedKey(role.role))}
          </Text>
          {role.role !== "official" ? (
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
              }}
              testID="role-info-note"
            >
              {t("eventHub.roleInfo.note")}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootNative: { justifyContent: "flex-end" },
  rootWeb: { justifyContent: "center", alignItems: "center" },
  panel: { width: "100%", borderWidth: 1 },
  panelNative: { borderTopStartRadius: 20, borderTopEndRadius: 20 },
  panelWeb: { maxWidth: 420, borderRadius: 20 },
  close: {
    position: "absolute",
    end: 8,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
});
