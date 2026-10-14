import { lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useTheme } from "@/theme";

/**
 * A screen part whose code the web app downloads the first time it is
 * shown, for areas most visitors never open on their first visit (the admin
 * tools, the engineering handbook...). On iOS/Android nothing changes.
 *
 * `load` is the area's loader (`area-loader.ts` next to its `area.ts`):
 * on iOS/Android and in tests it returns the area module itself, and the
 * component is used directly, exactly as before; on the web
 * (`area-loader.web.ts`) it returns `import("./area")`. Every screen of an
 * area loads the same `area.ts`, so the web build keeps the area in one
 * file of its own; importing it statically anywhere else puts it back into
 * the first download.
 *
 * While loading: a spinner. If the download fails (offline before the area
 * was ever opened): a short message with a retry button, never a blank or
 * broken screen.
 */
export function lazyScreenContent<M, P extends object>(
  load: () => M | Promise<M>,
  pick: (module: M) => ComponentType<P>,
  options: {
    /** A small part inside a row (a header button): nothing while it
     * loads, and nothing if it cannot be loaded. */
    inline?: boolean;
  } = {},
): ComponentType<P> {
  const first = load();
  if (!isPromise(first)) {
    return pick(first);
  }
  let pending: Promise<M> | null = first;
  const create = () =>
    lazy(async () => {
      // The first attempt reuses the download already started above.
      const module = await (pending ?? load());
      pending = null;
      return { default: pick(module) };
    });
  function LazyScreenContent(props: P) {
    // A fresh lazy component per retry: React caches a failed one forever.
    const [attempt, setAttempt] = useState(() => ({ Component: create() }));
    const { Component } = attempt;
    return (
      <ErrorBoundary
        fallback={(_error, reset) =>
          options.inline ? null : (
            <LoadFailed
              onRetry={() => {
                setAttempt({ Component: create() });
                reset();
              }}
            />
          )
        }
      >
        <Suspense fallback={options.inline ? null : <Loading />}>
          <Component {...props} />
        </Suspense>
      </ErrorBoundary>
    );
  }
  return LazyScreenContent;
}

function isPromise<M>(value: M | Promise<M>): value is Promise<M> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

function Centered({ children }: { children: ReactNode }) {
  const { spacing } = useTheme();
  return (
    <View style={[styles.centered, { padding: spacing[6], gap: spacing[3] }]}>
      {children}
    </View>
  );
}

function Loading() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Centered>
      <ActivityIndicator
        color={colors.text.secondary}
        accessibilityLabel={t("nav.loading")}
      />
    </Centered>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <Centered>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
          fontFamily: typography.bodyDefault.fontFamily,
          textAlign: "center",
        }}
      >
        {t("nav.loadFailed")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={{
          minHeight: 48,
          paddingHorizontal: spacing[5],
          justifyContent: "center",
          borderRadius: 999,
          borderWidth: 1,
          borderColor: colors.border.default,
        }}
      >
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.labelButton.fontSize,
            fontWeight: typography.labelButton.fontWeight,
            fontFamily: typography.labelButton.fontFamily,
          }}
        >
          {t("nav.retry")}
        </Text>
      </Pressable>
    </Centered>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
});
