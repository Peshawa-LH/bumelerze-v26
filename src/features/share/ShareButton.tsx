import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";

import type { Event } from "@/features/events";
import { useTheme } from "@/theme";

import { ShareSheet } from "./ShareSheet";

export interface ShareButtonProps {
  event: Event;
  /** Id for the link: the Bumelerze id when known, else the event's own id. */
  shareId: string;
}

/**
 * The share icon for a screen header. Opens the share sheet; the sheet (and
 * everything it loads) exists only while it is open.
 */
export function ShareButton({ event, shareId }: ShareButtonProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        testID="share-button"
        accessibilityRole="button"
        accessibilityLabel={t("share.title")}
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={styles.button}
      >
        <Ionicons name="share-outline" size={24} color={colors.text.primary} />
      </Pressable>
      {open ? (
        <ShareSheet event={event} shareId={shareId} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
