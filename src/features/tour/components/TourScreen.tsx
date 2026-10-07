import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isRTLLocale } from "@/i18n";
import { ProgressDots } from "@/features/onboarding";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import { TOUR_STOP_IDS, tourStopBodyKey, tourStopTitleKey } from "../stops";
import { useReduceMotion } from "../use-reduce-motion";
import { useSwipe } from "../use-swipe";
import { PhoneCard } from "./PhoneCard";
import { TOUR_PREVIEWS } from "./previews";

const SLIDE_DISTANCE = 36;
const SLIDE_MS = 220;

/**
 * The guided tour: one swipeable card per stop, each a live preview made of
 * the app's own components with sample data (so it follows theme, language and
 * right-to-left on its own), a short title and a line or two. Same chrome as
 * onboarding (progress dots, safe-area layout). Leaving it, by the last
 * button or Skip, goes back to where it was opened from: Home after
 * onboarding, Settings from the App tour row.
 */
export function TourScreen() {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const rtl = isRTLLocale(i18n.language);
  const locale = i18n.language;

  const [index, setIndex] = useState(0);
  const lastIndex = TOUR_STOP_IDS.length - 1;
  const isFirst = index === 0;
  const isLast = index === lastIndex;
  const stopId = TOUR_STOP_IDS[index] ?? TOUR_STOP_IDS[0];
  const Preview = TOUR_PREVIEWS[stopId];

  function exit() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }

  // Which way the last step went, for the slide-in direction.
  const direction = useRef<-1 | 1>(1);

  function go(delta: -1 | 1) {
    direction.current = delta;
    setIndex((current) => Math.min(lastIndex, Math.max(0, current + delta)));
  }

  const panHandlers = useSwipe(go, rtl);

  // A short slide-and-fade when the stop changes; none under reduce-motion.
  const [slide] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(1));
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (reduceMotion) {
      slide.setValue(0);
      fade.setValue(1);
      return;
    }
    // The new card enters from the side the next stop lies on.
    const enterFrom = direction.current * (rtl ? -1 : 1) * SLIDE_DISTANCE;
    slide.setValue(enterFrom);
    fade.setValue(0);
    const useNativeDriver = Platform.OS !== "web";
    const animation = Animated.parallel([
      Animated.timing(slide, { toValue: 0, duration: SLIDE_MS, useNativeDriver }),
      Animated.timing(fade, { toValue: 1, duration: SLIDE_MS, useNativeDriver }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [index, reduceMotion, rtl, slide, fade]);

  const progressLabel = t("tour.progress", {
    current: localizeDigits(String(index + 1), locale),
    total: localizeDigits(String(TOUR_STOP_IDS.length), locale),
  });

  return (
    <View
      testID="tour-screen"
      style={[
        styles.container,
        {
          backgroundColor: colors.surface.base,
          paddingTop: insets.top + spacing[4],
          paddingBottom: insets.bottom + spacing[5],
          paddingStart: spacing[5],
          paddingEnd: spacing[5],
        },
      ]}
    >
      <View style={styles.topRow}>
        <View accessible accessibilityLabel={progressLabel}>
          <ProgressDots totalSteps={TOUR_STOP_IDS.length} currentIndex={index} />
        </View>
        <Pressable
          testID="tour-skip"
          accessibilityRole="button"
          accessibilityLabel={t("tour.skip")}
          onPress={exit}
          hitSlop={8}
          style={styles.skip}
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("tour.skip")}
          </Text>
        </Pressable>
      </View>

      <Animated.View
        testID="tour-stop"
        style={[styles.stop, { opacity: fade, transform: [{ translateX: slide }] }]}
        {...panHandlers}
      >
        <ScrollView
          key={stopId}
          style={styles.scroll}
          contentContainerStyle={{ gap: spacing[4], paddingVertical: spacing[3] }}
          showsVerticalScrollIndicator={false}
        >
          <PhoneCard>
            <Preview />
          </PhoneCard>
          <View style={{ gap: spacing[2] }}>
            <Text
              accessibilityRole="header"
              style={{
                color: colors.text.primary,
                fontSize: typography.h1.fontSize,
                lineHeight: typography.h1.lineHeight,
                fontWeight: typography.h1.fontWeight,
              }}
            >
              {t(tourStopTitleKey(stopId))}
            </Text>
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
              }}
            >
              {t(tourStopBodyKey(stopId))}
            </Text>
          </View>
        </ScrollView>
      </Animated.View>

      <View style={[styles.buttons, { gap: spacing[3] }]}>
        {isFirst ? null : (
          <Pressable
            testID="tour-back"
            accessibilityRole="button"
            accessibilityLabel={t("tour.back")}
            onPress={() => go(-1)}
            style={[
              styles.button,
              { borderColor: colors.border.default, borderWidth: 1 },
            ]}
          >
            <Text
              style={{
                color: colors.text.link,
                fontSize: typography.labelButton.fontSize,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {t("tour.back")}
            </Text>
          </Pressable>
        )}
        <Pressable
          testID="tour-next"
          accessibilityRole="button"
          onPress={isLast ? exit : () => go(1)}
          style={[styles.button, styles.next, { backgroundColor: colors.brand.primary }]}
        >
          <Text
            style={{
              color: colors.brand.onPrimary,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
              textAlign: "center",
            }}
          >
            {isLast ? t("tour.finish") : t("tour.next")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  skip: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  stop: {
    flex: 1,
    // A mouse drag across the card must swipe the tour, not select its text.
    userSelect: "none",
  },
  scroll: {
    flex: 1,
  },
  buttons: {
    flexDirection: "row",
  },
  button: {
    minHeight: 48,
    minWidth: 96,
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  next: {
    flex: 1,
  },
});
