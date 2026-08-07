import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";
import { ONBOARDING_STEPS, type OnboardingStepId } from "../store";
import { ProgressDots } from "./ProgressDots";

interface OnboardingScreenShellProps {
  step: OnboardingStepId;
  title: string;
  description?: string;
  /** Screen-specific content (permission button, town list, ...) rendered
   * below the title/description, inside the scrollable region. */
  children?: ReactNode;
  primaryLabel: string;
  onPrimaryPress: () => void;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
  /** The mission screen (first step) has nothing to go back to. */
  showBack?: boolean;
}

/**
 * Shared layout for every onboarding screen (spec-v1.md §4.11: "one idea
 * per screen", wave brief: "progress dots, back navigation"). One shell so
 * every screen gets the same header/footer chrome and RTL/safe-area
 * handling for free, matching how EventListScreen is shared across
 * Home/World/Significant.
 */
export function OnboardingScreenShell({
  step,
  title,
  description,
  children,
  primaryLabel,
  onPrimaryPress,
  primaryDisabled = false,
  secondaryLabel,
  onSecondaryPress,
  showBack = true,
}: OnboardingScreenShellProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const stepIndex = ONBOARDING_STEPS.indexOf(step);

  function handleBack() {
    // A resumed-after-restart screen (see app/onboarding/index.tsx) arrives
    // via `router.replace`, so it has no back history — fall back to the
    // start of the flow instead of a no-op/crash on `router.back()`.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/onboarding");
    }
  }

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
        <View style={styles.backSlot}>
          {showBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("onboarding.back")}
              onPress={handleBack}
              hitSlop={12}
            >
              <Text
                style={{
                  color: colors.text.link,
                  fontSize: typography.labelButton.fontSize,
                  fontWeight: typography.labelButton.fontWeight,
                }}
              >
                {t("onboarding.back")}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <ProgressDots totalSteps={ONBOARDING_STEPS.length} currentIndex={stepIndex} />
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
            fontSize: typography.h1.fontSize,
            lineHeight: typography.h1.lineHeight,
            fontWeight: typography.h1.fontWeight,
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

      <View style={{ gap: spacing[3] }}>
        {secondaryLabel && onSecondaryPress ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSecondaryPress}
            style={styles.secondaryButton}
          >
            <Text
              style={{
                color: colors.text.link,
                fontSize: typography.labelButton.fontSize,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {secondaryLabel}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: primaryDisabled }}
          disabled={primaryDisabled}
          onPress={onPrimaryPress}
          style={[
            styles.primaryButton,
            {
              backgroundColor: colors.brand.primary,
              opacity: primaryDisabled ? 0.5 : 1,
              paddingVertical: spacing[3],
            },
          ]}
        >
          <Text
            style={{
              color: colors.brand.onPrimary,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {primaryLabel}
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
  },
  backSlot: {
    minWidth: 40,
  },
  scroll: {
    flex: 1,
  },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  // minHeight: 48 (accessibility-tester Phase 5 audit) — paddingVertical
  // alone (spacing[3] = 12) measured right at the 44pt floor for this
  // button's labelButton text, not a comfortable 48dp; every onboarding
  // screen's primary CTA goes through this one style, so this single fix
  // covers the whole flow.
  primaryButton: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
});
