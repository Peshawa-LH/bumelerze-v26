import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewProps,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import {
  distanceFromUserKm,
  formatAbsoluteDual,
  formatDepthKm,
  formatIsolatedDistance,
  formatMagnitudeValue,
  formatRelativeTimeValue,
  getRelativeTime,
  isolateNumeric,
  ProvenanceChip,
  type Event,
} from "@/features/events";
import { encodeEventRegistrationParam, toEventRegistration } from "@/features/felt";
import { placeLine } from "@/features/geo";
import { useUserDistanceAnchor } from "@/features/location";
import { useTheme } from "@/theme";

import {
  resolveSheetSnapOutcome,
  sheetTotalHeightPx,
  sheetTranslateYForDetent,
  type SheetDetent,
} from "../event-sheet";
import { useReducedMotionPreference } from "../reduced-motion";

/** Spring used for every settle-to-detent animation (drag release, button
 * tap, entrance). Not tuned against a device — a deliberately snappy-but-
 * not-bouncy feel matching the familiar maps-app sheet this is modelled on;
 * skipped entirely (an instant jump) when `useReducedMotionPreference()` is
 * true. */
const SHEET_SPRING_CONFIG = { damping: 30, stiffness: 260, mass: 0.9 };
/** Close (dismiss) uses a plain timing curve, not the spring above — a
 * spring can overshoot/settle slightly past its target, which would leave
 * the sheet's `translateY` a few px short of `sheetTotalHeightPx` (still
 * technically "closed" visually, but the wrong resting value to hand off to
 * `onDismiss`'s `finished` check). */
const SHEET_CLOSE_DURATION_MS = 220;
/** Initial off-screen resting position, before the first `onLayout` reports
 * a real container height — generously larger than any real device's
 * height, so the sheet always starts fully hidden below the visible frame
 * regardless of the eventual real size, then animates up to "peek" the
 * moment layout resolves (the wave brief's expected slide-up entrance). */
const OFFSCREEN_TRANSLATE_Y_PX = 4000;

export interface EventPreviewSheetHandle {
  /** Lets a caller OUTSIDE the sheet's own gesture/button tree (the map's
   * "clicking the background dismisses it" handler — a MapLibre canvas
   * click, not a React event this component could otherwise observe)
   * trigger the same animated close path a button press or Escape would. */
  requestClose: () => void;
}

interface EventPreviewSheetProps {
  /** The parent only ever mounts this component once an event is selected
   * (`{selectedEvent ? <EventPreviewSheet event={selectedEvent} .../> :
   * null}`) — so this is never null for the component's own lifetime,
   * including while it's animating closed (the parent clears its selection
   * from `onDismiss`, fired only once that animation's `finished` callback
   * runs, not before). */
  event: Event;
  detent: SheetDetent;
  onDetentChange: (detent: SheetDetent) => void;
  /** Called once the close animation has visually finished (or immediately,
   * under reduced motion) — the parent's cue to clear its selection and let
   * this component unmount. */
  onDismiss: () => void;
}

function EventPreviewSheetImpl(
  { event, detent, onDetentChange, onDismiss }: EventPreviewSheetProps,
  ref: Ref<EventPreviewSheetHandle>,
) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const prefersReducedMotion = useReducedMotionPreference();

  const [containerHeightPx, setContainerHeightPx] = useState(0);
  // Reanimated `SharedValue`s are the one documented, intentional exception
  // to "never mutate a value returned by a hook": assigning `.value` is
  // Reanimated's OWN public API for driving an animation (this file's every
  // `.value = ...` write below), not an accidental render-phase mutation —
  // `eslint-plugin-react-hooks`'s newer React-Compiler-oriented
  // `react-hooks/immutability` rule has no special case for it yet (this is
  // the first Reanimated usage anywhere in this codebase), so each site
  // carries its own short, scoped disable rather than silencing the rule
  // file-wide.
  const translateY = useSharedValue(OFFSCREEN_TRANSLATE_Y_PX);
  const startTranslateY = useSharedValue(0);
  const dialogRef = useRef<View>(null);

  const isExpanded = detent === "expanded";

  const handleLayout = useCallback((layoutEvent: LayoutChangeEvent) => {
    setContainerHeightPx(layoutEvent.nativeEvent.layout.height);
  }, []);

  const animateToDetent = useCallback(
    (targetDetent: SheetDetent) => {
      if (containerHeightPx <= 0) {
        return;
      }
      const target = sheetTranslateYForDetent(targetDetent, containerHeightPx);
      // eslint-disable-next-line react-hooks/immutability -- see the `translateY` doc comment above
      translateY.value = prefersReducedMotion
        ? target
        : withSpring(target, SHEET_SPRING_CONFIG);
    },
    [containerHeightPx, prefersReducedMotion, translateY],
  );

  const animateClose = useCallback(() => {
    const target =
      containerHeightPx > 0 ? sheetTotalHeightPx(containerHeightPx) : OFFSCREEN_TRANSLATE_Y_PX;
    if (prefersReducedMotion) {
      // eslint-disable-next-line react-hooks/immutability -- see the `translateY` doc comment above
      translateY.value = target;
      onDismiss();
      return;
    }
    translateY.value = withTiming(
      target,
      { duration: SHEET_CLOSE_DURATION_MS },
      (finished) => {
        if (finished) {
          runOnJS(onDismiss)();
        }
      },
    );
  }, [containerHeightPx, prefersReducedMotion, translateY, onDismiss]);

  // (Re)targets the resting position whenever the requested detent changes,
  // a NEW event is selected (`event.id` — the controller always resets
  // `detent` back to "peek" on selection, but the numeric PIXEL target still
  // needs recomputing here even when the detent VALUE is unchanged), or the
  // container is measured/resized. Also the entrance animation: on first
  // mount `translateY` starts at `OFFSCREEN_TRANSLATE_Y_PX` (see its own doc
  // comment), so the very first run of this effect (once `onLayout` reports
  // a real height) animates it up into view.
  useEffect(() => {
    animateToDetent(detent);
  }, [detent, event.id, animateToDetent]);

  const handleOpenFull = useCallback(() => {
    // Settle the sheet back to a clean "peek" baseline (not left mid-drag)
    // before navigating away — if the user returns to Map via the event
    // screen's own back affordance, the sheet greets them again at a normal
    // resting position rather than wherever a drag happened to leave it.
    onDetentChange("peek");
    animateToDetent("peek");
    // `origin: "map"` (read by `app/event/[id].tsx`) is what makes THIS
    // specific navigation path add its own explicit "back to map" button on
    // top of the screen's normal header-back — see that screen's own doc
    // comment for why a plain `router.push` alone isn't quite enough
    // (notification taps and other entry points push `/event/[id]` too, and
    // must NOT get a map-specific back affordance).
    router.push({ pathname: "/event/[id]", params: { id: event.id, origin: "map" } });
  }, [router, event.id, onDetentChange, animateToDetent]);

  const handleFeltReport = useCallback(() => {
    router.push({
      pathname: "/felt-report",
      params: {
        eventId: event.id,
        eventReg: encodeEventRegistrationParam(toEventRegistration(event)),
      },
    });
  }, [router, event]);

  const handleDragEnd = useCallback(
    (currentTranslateYPx: number, velocityY: number) => {
      if (containerHeightPx <= 0) {
        return;
      }
      const currentHeightPx = sheetTotalHeightPx(containerHeightPx) - currentTranslateYPx;
      const outcome = resolveSheetSnapOutcome({
        currentHeightPx,
        velocityY,
        containerHeightPx,
      });
      if (outcome === "dismiss") {
        animateClose();
        return;
      }
      if (outcome === "openFull") {
        handleOpenFull();
        return;
      }
      animateToDetent(outcome);
      onDetentChange(outcome);
    },
    [containerHeightPx, animateClose, animateToDetent, onDetentChange, handleOpenFull],
  );

  const maxTranslateYPx = containerHeightPx > 0 ? sheetTotalHeightPx(containerHeightPx) : 0;
  const panGesture = Gesture.Pan()
    .onStart(() => {
      startTranslateY.value = translateY.value;
    })
    .onUpdate((gestureEvent) => {
      const next = startTranslateY.value + gestureEvent.translationY;
      // eslint-disable-next-line react-hooks/immutability -- see the `translateY` doc comment above
      translateY.value = Math.min(Math.max(next, 0), maxTranslateYPx);
    })
    .onEnd((gestureEvent) => {
      runOnJS(handleDragEnd)(translateY.value, gestureEvent.velocityY);
    });

  useImperativeHandle(ref, () => ({ requestClose: animateClose }), [animateClose]);

  // Keyboard parity (wave brief point 5): Escape dismisses, matching the
  // close button/background-click paths — web-only (`Platform.OS`, not a
  // feature flag): a physical Escape key is a desktop/web-input concern,
  // native has no equivalent to intercept here.
  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }
    function handleKeyDown(domEvent: KeyboardEvent) {
      if (domEvent.key === "Escape") {
        animateClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [animateClose]);

  // Focus management (wave brief point 5): moves keyboard focus into the
  // sheet the moment it mounts (screen readers announce the `role="dialog"`
  // + `aria-label` set below the instant focus lands on it), and restores
  // focus to whatever was focused before (the tapped marker, in the common
  // case) the moment it unmounts — web-only, same reasoning as the Escape
  // effect above; native accessibility focus is a different API
  // (`AccessibilityInfo.setAccessibilityFocus`) tied to a native view tag,
  // left for the native map screen's own follow-up wave.
  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = dialogRef.current as unknown as HTMLElement | null;
    node?.focus?.();
    return () => {
      previouslyFocused?.focus?.();
    };
    // Intentionally empty deps — this must run exactly once on mount and
    // once on unmount, not on every re-render (a re-render while the sheet
    // is already open, e.g. a detent change, must not steal focus back or
    // re-capture a now-stale "previously focused" element).
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const magnitudeText = t("events.magnitudeDisplay", {
    value: formatMagnitudeValue(event.magnitude.value, locale),
  });
  const placeText = placeLine(event, locale, t);
  const { local: localTimeText } = formatAbsoluteDual(event.originTime, locale, t);
  // Same relative-time formatting `EventCard` uses for the feed (one module
  // owns it — `format.ts` — per typescript-react-native.md's "units &
  // science" rule), not a bespoke sheet-only phrasing. Relative-time math
  // only needs a roughly-current instant (re-selecting an event re-renders
  // this fresh) — see `EventListScreen.tsx`'s own identical `now` read for
  // the full rationale on why this deliberately non-memoized read is
  // correct, not a bug the purity rule should block.
  // eslint-disable-next-line react-hooks/purity -- see comment above
  const relativeTime = getRelativeTime(event.originTime, Date.now());
  const relativeTimeText =
    relativeTime.unit === "justNow"
      ? t("events.relativeTime.justNow")
      : t(`events.relativeTime.${relativeTime.unit}`, {
          value: formatRelativeTimeValue(relativeTime.value, locale),
        });

  const userFix = useUserDistanceAnchor();
  const distanceText = userFix.hasFix
    ? t("events.distanceFromYou", {
        distance: formatIsolatedDistance(
          distanceFromUserKm(event, userFix),
          locale,
          t("units.km"),
        ),
      })
    : null;

  const a11yLabel = [
    t("events.magnitudeA11yLabel", {
      value: formatMagnitudeValue(event.magnitude.value, locale),
    }),
    placeText,
  ]
    .filter(Boolean)
    .join(". ");

  const webDialogProps: Partial<ViewProps> | null =
    Platform.OS === "web"
      ? {
          // Raw DOM attributes forwarded through by react-native-web on an
          // unrecognized prop — same precedent as `EventCard.tsx`'s `dir`
          // prop.
          role: "dialog",
          "aria-label": a11yLabel,
          "aria-modal": false,
          tabIndex: -1,
        }
      : null;

  return (
    <View
      pointerEvents="box-none"
      onLayout={handleLayout}
      style={styles.overlay}
      testID="event-preview-sheet-overlay"
    >
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            styles.sheet,
            animatedStyle,
            {
              height: containerHeightPx > 0 ? sheetTotalHeightPx(containerHeightPx) : 0,
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View
            ref={dialogRef}
            {...webDialogProps}
            style={styles.dialogContent}
            testID="event-preview-sheet"
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.handleRow, { paddingTop: spacing[2] }]}
            >
              <View style={[styles.grabHandle, { backgroundColor: colors.border.default }]} />
            </View>

            <View style={[styles.topControlsRow, { paddingHorizontal: spacing[3] }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isExpanded
                    ? t("map.eventSheet.collapseButtonLabel")
                    : t("map.eventSheet.expandButtonLabel")
                }
                onPress={() => {
                  const nextDetent: SheetDetent = isExpanded ? "peek" : "expanded";
                  onDetentChange(nextDetent);
                  animateToDetent(nextDetent);
                }}
                hitSlop={12}
                style={styles.iconButton}
              >
                <Ionicons
                  name={isExpanded ? "chevron-down" : "chevron-up"}
                  size={20}
                  color={colors.text.secondary}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("map.eventSheet.closeButtonLabel")}
                onPress={animateClose}
                hitSlop={12}
                style={styles.iconButton}
              >
                <Ionicons name="close" size={20} color={colors.text.secondary} />
              </Pressable>
            </View>

            <View
              style={[
                styles.body,
                { paddingHorizontal: spacing[4], paddingBottom: spacing[4], gap: spacing[2] },
              ]}
            >
              <View style={styles.topRow}>
                <Text
                  allowFontScaling
                  style={{
                    color: colors.text.primary,
                    fontSize: typography.magnitudeCompact.fontSize,
                    lineHeight: typography.magnitudeCompact.lineHeight,
                    fontWeight: typography.magnitudeCompact.fontWeight,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {magnitudeText}
                </Text>
                <ProvenanceChip provider={event.provenance.provider} />
              </View>

              <Text
                allowFontScaling
                style={{
                  color: colors.text.primary,
                  fontSize: typography.bodyDefault.fontSize,
                  lineHeight: typography.bodyDefault.lineHeight,
                }}
              >
                {placeText}
              </Text>

              <View style={[styles.metaRow, { gap: spacing[3] }]}>
                <Text
                  allowFontScaling
                  style={{
                    color: colors.text.secondary,
                    fontSize: typography.bodyMeta.fontSize,
                    lineHeight: typography.bodyMeta.lineHeight,
                  }}
                >
                  {relativeTimeText}
                </Text>
                {distanceText ? (
                  <Text
                    allowFontScaling
                    style={{
                      color: colors.text.secondary,
                      fontSize: typography.bodyMeta.fontSize,
                      lineHeight: typography.bodyMeta.lineHeight,
                    }}
                  >
                    {distanceText}
                  </Text>
                ) : null}
              </View>

              {isExpanded ? (
                <View style={{ gap: spacing[1] }}>
                  <Text
                    allowFontScaling
                    style={{
                      color: colors.text.secondary,
                      fontSize: typography.bodyMeta.fontSize,
                      lineHeight: typography.bodyMeta.lineHeight,
                    }}
                  >
                    {t("eventDetail.localTimeLabel")}: {isolateNumeric(localTimeText)}
                  </Text>
                  <Text
                    allowFontScaling
                    style={{
                      color: colors.text.secondary,
                      fontSize: typography.bodyMeta.fontSize,
                      lineHeight: typography.bodyMeta.lineHeight,
                    }}
                  >
                    {t("eventDetail.depthSectionTitle")}:{" "}
                    {isolateNumeric(`${formatDepthKm(event.depthKm, locale)} ${t("units.km")}`)}
                  </Text>
                </View>
              ) : null}

              <View style={[styles.actionsRow, { gap: spacing[3], marginTop: spacing[2] }]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleFeltReport}
                  style={[
                    styles.actionButton,
                    {
                      backgroundColor: colors.action.felt,
                      paddingHorizontal: spacing[4],
                      paddingVertical: spacing[3],
                    },
                  ]}
                >
                  <Text
                    allowFontScaling
                    style={{
                      color: colors.action.feltOnFill,
                      fontSize: typography.labelButton.fontSize,
                      fontWeight: typography.labelButton.fontWeight,
                    }}
                  >
                    {t("felt.pill.label")}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleOpenFull}
                  style={[
                    styles.actionButton,
                    styles.openFullButton,
                    {
                      borderColor: colors.border.default,
                      paddingHorizontal: spacing[4],
                      paddingVertical: spacing[3],
                    },
                  ]}
                >
                  <Text
                    allowFontScaling
                    style={{
                      color: colors.text.primary,
                      fontSize: typography.labelButton.fontSize,
                      fontWeight: typography.labelButton.fontWeight,
                    }}
                  >
                    {t("map.eventSheet.openFullButtonLabel")}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export const EventPreviewSheet = forwardRef(EventPreviewSheetImpl);

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    start: 0,
    end: 0,
    bottom: 0,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  sheet: {
    position: "absolute",
    start: 0,
    end: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopStartRadius: 16,
    borderTopEndRadius: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  dialogContent: {
    flex: 1,
  },
  handleRow: {
    alignItems: "center",
  },
  grabHandle: {
    width: 36,
    height: 4,
    borderRadius: 999,
  },
  topControlsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  actionsRow: {
    flexDirection: "row",
  },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  openFullButton: {
    borderWidth: 1,
  },
});
