import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { Event } from "@/features/events";
import { toEventRegistration } from "@/features/felt";
import { useUserDistanceAnchor } from "@/features/location";
import { useTheme } from "@/theme";

import { markPromptHandled, useCheckInStore } from "../queue";
import { pickBannerEvent } from "../relevance";
import { CheckInPanel } from "./CheckInPanel";

/**
 * Which earthquake the Home banner asks about (entry T2), or null. Computed
 * on the phone from its last known fix; the position never leaves it. Once
 * shown, the banner stays for the session until answered or closed, so the
 * "Saved" / "Your family can see it" line stays readable after the tap.
 */
export function useSafePrompt(events: readonly Event[]): {
  event: Event | null;
  dismiss: () => void;
} {
  const anchor = useUserDistanceAnchor();
  const handled = useCheckInStore((s) => s.handled);
  const lastAction = useCheckInStore((s) => s.lastAction);
  const hydrated = useCheckInStore((s) => s.hasHydrated);
  const [sticky, setSticky] = useState<Event | null>(null);
  const [closed, setClosed] = useState<string | null>(null);

  const picked =
    hydrated && anchor.hasFix
      ? pickBannerEvent(
          events,
          { lat: anchor.lat, lon: anchor.lon },
          { handled, lastAction },
        )
      : null;

  // Remember the latest picked event (state adjusted during render, React's
  // "storing information from previous renders" pattern; no effect needed).
  if (picked && picked.id !== sticky?.id) {
    setSticky(picked);
  }

  const event = sticky && sticky.id !== closed ? sticky : null;
  return {
    event,
    dismiss: () => {
      if (event) setClosed(event.id);
    },
  };
}

/** The Home banner: not a blocking modal; it takes the "Be ready" card's
 * place while it is up. "Not now" answers it for this event. */
export function HomeSafeBanner({
  event,
  onDismiss,
}: {
  event: Event;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const registration = toEventRegistration(event);
  // "Not now" and the close button both answer the prompt for this event.
  const answer = () => {
    markPromptHandled(
      `${registration.provider}:${registration.providerId}`,
      event.magnitude.value,
    );
    onDismiss();
  };
  return (
    <View style={{ paddingHorizontal: spacing[4], paddingBottom: spacing[3] }}>
      <View
        testID="home-safe-banner"
        accessibilityLabel={t("imSafe.banner.a11y")}
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          {
            backgroundColor: colors.surface.raised,
            borderColor: colors.brand.primary,
            padding: spacing[4],
          },
        ]}
      >
        <Pressable
          testID="home-safe-close"
          accessibilityRole="button"
          accessibilityLabel={t("home.beReady.dismiss")}
          hitSlop={4}
          onPress={answer}
          style={styles.close}
        >
          <Ionicons name="close" size={20} color={colors.text.tertiary} />
        </Pressable>
        <CheckInPanel event={registration} testID="home-safe-panel" onNotNow={answer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: 14 },
  close: {
    position: "absolute",
    top: 4,
    end: 4,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
});
