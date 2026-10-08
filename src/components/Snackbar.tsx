import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";

/** How long a snackbar stays up. 8 s for a person's own delete, 10 s for an
 * admin's hide or remove (the research note's 5-10 s range). */
export const SNACKBAR_MS = 8000;
export const SNACKBAR_ADMIN_MS = 10_000;

/** Height of the tab bar without the bottom safe-area inset. The tab layout
 * uses the same number, so a snackbar on a tab screen sits right above it. */
export const TAB_BAR_CONTENT_HEIGHT = 58;

export interface SnackbarOptions {
  /** Already translated. */
  message: string;
  /** Already translated, e.g. "Undo". Without it the snackbar is a plain
   * notice. */
  actionLabel?: string;
  /** Runs when the action is tapped. A rejection shows the generic "could not
   * be undone" notice; the snackbar closes either way. */
  onAction?: () => void | Promise<void>;
  /** Milliseconds; defaults to 8 s. */
  durationMs?: number;
}

export interface SnackbarApi {
  show: (options: SnackbarOptions) => void;
  dismiss: () => void;
}

const NOOP_API: SnackbarApi = { show: () => undefined, dismiss: () => undefined };

const SnackbarContext = createContext<SnackbarApi>(NOOP_API);

/** The one place any screen shows a transient "done, Undo" message. Without a
 * provider (a unit test of a single component) it does nothing. */
export function useSnackbar(): SnackbarApi {
  return useContext(SnackbarContext);
}

interface ActiveSnackbar extends SnackbarOptions {
  key: number;
}

/**
 * One snackbar at a time, bottom of the screen above the tab bar. A new one
 * replaces the old. It announces itself to screen readers, closes itself after
 * `durationMs` and works the same on web. The server has already done the
 * delete when it appears: the action only calls a restore function, so
 * closing the app loses nothing.
 */
export function SnackbarProvider({
  children,
  bottomOffset = 0,
}: {
  children: ReactNode;
  /** Extra space under the snackbar, e.g. the tab bar's height. */
  bottomOffset?: number;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<ActiveSnackbar | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setActive(null);
  }, [clearTimer]);

  const show = useCallback(
    (options: SnackbarOptions) => {
      clearTimer();
      counter.current += 1;
      setActive({ ...options, key: counter.current });
      void AccessibilityInfo.announceForAccessibility(options.message);
      timer.current = setTimeout(() => {
        timer.current = null;
        setActive(null);
      }, options.durationMs ?? SNACKBAR_MS);
    },
    [clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const api = useMemo<SnackbarApi>(() => ({ show, dismiss }), [show, dismiss]);

  async function handleAction(current: ActiveSnackbar) {
    dismiss();
    try {
      await current.onAction?.();
    } catch {
      show({ message: t("snackbar.undoFailed") });
    }
  }

  return (
    <SnackbarContext.Provider value={api}>
      {children}
      {active ? (
        <SnackbarView
          key={active.key}
          item={active}
          bottomOffset={bottomOffset}
          onAction={() => void handleAction(active)}
        />
      ) : null}
    </SnackbarContext.Provider>
  );
}

function SnackbarView({
  item,
  bottomOffset,
  onAction,
}: {
  item: ActiveSnackbar;
  bottomOffset: number;
  onAction: () => void;
}) {
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const hasAction = item.actionLabel !== undefined && item.onAction !== undefined;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.host,
        {
          bottom: insets.bottom + bottomOffset + spacing[3],
          paddingHorizontal: spacing[3],
        },
      ]}
    >
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID="snackbar"
        style={[
          styles.bar,
          {
            backgroundColor: colors.text.primary,
            paddingStart: spacing[4],
            paddingEnd: spacing[2],
            gap: spacing[2],
          },
        ]}
      >
        <Text
          testID="snackbar-message"
          style={{
            flex: 1,
            color: colors.text.inverse,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
            paddingVertical: spacing[2],
            // Follows the language of the message, i.e. the app's.
            textAlign: "auto",
          }}
        >
          {item.message}
        </Text>
        {hasAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.actionLabel}
            onPress={onAction}
            hitSlop={8}
            testID="snackbar-action"
            style={styles.action}
          >
            <Text
              style={{
                color: colors.text.inverse,
                fontSize: typography.bodyMeta.fontSize,
                fontWeight: "700",
                textDecorationLine: "underline",
              }}
            >
              {item.actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    start: 0,
    end: 0,
    alignItems: "center",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 560,
    minHeight: 48,
    borderRadius: 12,
    elevation: 6,
    shadowColor: "#000000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
  },
});
