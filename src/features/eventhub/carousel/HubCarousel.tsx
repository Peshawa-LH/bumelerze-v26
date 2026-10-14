import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from "react-native";
import { useTranslation } from "react-i18next";

import { isolateNumeric } from "@/features/events/format";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

export interface CarouselSlide {
  key: string;
  /** Spoken with the position: "Felt shaking by town, 3 of 4". */
  title: string;
  /** Draws the slide at `size` x `size`. */
  render: (size: number) => ReactNode;
}

/** All slides are drawn at the same square size, never wider than this. */
export const SLIDE_MAX = 430;
/** White on the dark counter chip, in both themes (the chip sits on the
 * slide, not on the page). */
const COUNTER_TEXT = "#FFFFFF";
const COUNTER_BG = "rgba(0, 0, 0, 0.66)";
/** A swipe must travel this far (dp) to change the slide. */
const SWIPE_DISTANCE = 40;

/**
 * Which way a finished horizontal swipe moves: +1 to the next slide, -1 to
 * the previous, 0 for a swipe too short to count. Forward is a swipe towards
 * the start edge: to the left in English and Kurmanji, to the right in
 * Sorani and Arabic, where slide 1 sits on the right.
 */
export function swipeStep(dx: number, rtl: boolean): -1 | 0 | 1 {
  if (Math.abs(dx) <= SWIPE_DISTANCE) {
    return 0;
  }
  const towardsLeft = dx < 0;
  return towardsLeft !== rtl ? 1 : -1;
}

/**
 * The Event hub's swipeable slides (review note 4.3). Only the slide in
 * view is drawn (a low-end phone never holds five charts at once); a swipe,
 * a dot or the accessibility increment/decrement moves between them. Dots
 * and the "1/4" counter count only the slides this event has. In Sorani and
 * Arabic the order and the swipe mirror: slide 1 sits on the right and a
 * swipe to the right moves on.
 */
export function HubCarousel({
  slides,
  testID = "hub-carousel",
}: {
  slides: readonly CarouselSlide[];
  testID?: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const rtl = i18n.dir() === "rtl";
  const window = useWindowDimensions();
  const [width, setWidth] = useState(0);
  // The slide in view is remembered by key, so a slide that appears later
  // (data arriving) never moves the reader to another one.
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const foundIndex = slides.findIndex((slide) => slide.key === currentKey);
  const index = foundIndex >= 0 ? foundIndex : 0;
  const count = slides.length;

  // A slide that vanished (its data went away) simply leaves index 0 in
  // view: `index` falls back to the first slide when its key is gone.
  const go = useCallback(
    (next: number) => {
      if (slides.length === 0) return;
      const clamped = Math.max(0, Math.min(slides.length - 1, next));
      setCurrentKey(slides[clamped]?.key ?? null);
    },
    [slides],
  );

  // Rebuilt when the slide in view changes, so the release handler always
  // sees the current position and direction.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_event, gesture) => {
          const step = swipeStep(gesture.dx, rtl);
          if (step !== 0) go(index + step);
        },
      }),
    [go, index, rtl],
  );

  if (count === 0) {
    return null;
  }
  // Before the first layout the screen width (less the page padding) stands in.
  const size = Math.max(0, Math.min(width > 0 ? width : window.width - 40, SLIDE_MAX));
  const slide = slides[index] as CarouselSlide;
  const position = (n: number) =>
    isolateNumeric(localizeDigits(String(n), i18n.language));
  const counterText = isolateNumeric(
    `${localizeDigits(String(index + 1), i18n.language)}/${localizeDigits(String(count), i18n.language)}`,
  );

  function onAction(event: AccessibilityActionEvent) {
    if (event.nativeEvent.actionName === "increment") go(index + 1);
    if (event.nativeEvent.actionName === "decrement") go(index - 1);
  }

  return (
    <View
      testID={testID}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={{ gap: spacing[2] }}
    >
      <View
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t("eventHub.slides.position", {
          title: slide.title,
          number: position(index + 1),
          total: position(count),
        })}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={onAction}
        style={[styles.frame, { width: size, height: size }]}
        testID={`${testID}-slide-${slide.key}`}
      >
        {size > 0 ? slide.render(size) : null}
        {count > 1 ? (
          <View
            style={[styles.counter, { backgroundColor: COUNTER_BG }]}
            testID={`${testID}-counter`}
          >
            <Text
              style={{
                color: COUNTER_TEXT,
                fontSize: typography.labelCaption.fontSize,
                fontWeight: "600",
              }}
            >
              {counterText}
            </Text>
          </View>
        ) : null}
      </View>
      {count > 1 ? (
        <View style={[styles.dots, { gap: spacing[2] }]}>
          {slides.map((item, i) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={t("eventHub.slides.goTo", {
                title: item.title,
                number: position(i + 1),
              })}
              accessibilityState={{ selected: i === index }}
              onPress={() => go(i)}
              hitSlop={{ top: 14, bottom: 14, left: 6, right: 6 }}
              testID={`${testID}-dot-${item.key}`}
            >
              <View
                style={[
                  styles.dot,
                  i === index
                    ? { width: 18, backgroundColor: colors.brand.primary }
                    : { backgroundColor: colors.border.default },
                ]}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignSelf: "center", borderRadius: 12, overflow: "hidden" },
  // At the end edge, away from the share image's magnitude (at the start
  // edge in every language). The web app root sets the reading direction
  // (AppRoot.web.tsx), so `end` is the left edge in Sorani and Arabic on
  // the web too.
  counter: {
    position: "absolute",
    top: 10,
    end: 10,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    minHeight: 20,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
