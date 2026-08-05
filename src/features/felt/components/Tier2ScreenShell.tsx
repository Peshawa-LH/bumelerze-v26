import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProgressDots } from "@/features/onboarding";
import { useTheme } from "@/theme";

interface Tier2ScreenShellProps {
  currentIndex: number;
  totalSteps: number;
  title: string;
  description?: string;
  children?: ReactNode;
  onBack: () => void;
  /** Omitted on the final (comment) screen, which has its own submit
   * button instead of a skip-to-next affordance. */
  onSkip?: () => void;
}

/**
 * Shared chrome for the tier-2 question flow (spec-v1.md §4.6: "progress
 * indication; every question skippable; back navigation") — the tier-2
 * analog of `features/onboarding/components/OnboardingScreenShell.tsx`,
 * reusing the same `ProgressDots` component so both flows read identically.
 * Kept as its own shell (not a generalized version of the onboarding one)
 * because it has no onboarding-store dependency and a different footer
 * shape (skip, not a single primary CTA — most steps advance by picking an
 * option, not by pressing a button).
 */
export function Tier2ScreenShell({
  currentIndex,
  totalSteps,
  title,
  description,
  children,
  onBack,
  onSkip,
}: Tier2ScreenShellProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("felt.tier2.back")}
          onPress={onBack}
          hitSlop={12}
          style={styles.backSlot}
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("felt.tier2.back")}
          </Text>
        </Pressable>
        <ProgressDots totalSteps={totalSteps} currentIndex={currentIndex} />
        <View style={styles.backSlot} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ gap: spacing[3], paddingVertical: spacing[4] }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          accessibilityRole="header"
          style={{
            color: colors.text.primary,
            fontSize: typography.h2.fontSize,
            lineHeight: typography.h2.lineHeight,
            fontWeight: typography.h2.fontWeight,
          }}
        >
          {title}
        </Text>
        {description ? (
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {description}
          </Text>
        ) : null}
        {children}
      </ScrollView>

      {onSkip ? (
        <Pressable accessibilityRole="button" onPress={onSkip} style={styles.skipButton}>
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("felt.tier2.skip")}
          </Text>
        </Pressable>
      ) : null}
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
  },
  backSlot: {
    minWidth: 40,
  },
  scroll: {
    flex: 1,
  },
  skipButton: {
    alignItems: "center",
    paddingVertical: 8,
  },
});
