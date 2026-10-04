import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useTheme } from "@/theme";

/** Small presentational pieces shared by the Tag-my-building screens. Theme
 * tokens only; start/end (never left/right) so every layout mirrors in RTL. */

export function Heading({
  children,
  level = 2,
}: {
  children: ReactNode;
  level?: 1 | 2 | 3;
}) {
  const { colors, typography } = useTheme();
  const token = level === 1 ? typography.h1 : level === 2 ? typography.h2 : typography.h3;
  return (
    <Text accessibilityRole="header" style={[token, { color: colors.text.primary }]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  tone = "primary",
  testID,
}: {
  children: ReactNode;
  tone?: "primary" | "secondary";
  testID?: string;
}) {
  const { colors, typography } = useTheme();
  return (
    <Text
      testID={testID}
      style={[
        typography.bodyDefault,
        { color: tone === "primary" ? colors.text.primary : colors.text.secondary },
      ]}
    >
      {children}
    </Text>
  );
}

export function Meta({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors, typography } = useTheme();
  return (
    <Text testID={testID} style={[typography.bodyMeta, { color: colors.text.secondary }]}>
      {children}
    </Text>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const { colors, typography } = useTheme();
  return (
    <Text
      accessibilityRole="alert"
      style={[typography.bodyDefault, { color: colors.status.danger }]}
    >
      {children}
    </Text>
  );
}

export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors, spacing } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[3],
        },
      ]}
    >
      {children}
    </View>
  );
}

/** One big answer button (at least 56 px tall) of a one-question-per-screen flow. */
export function OptionButton({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.option,
        {
          borderColor: selected ? colors.brand.primary : colors.border.default,
          backgroundColor: selected ? colors.surface.sunken : colors.surface.raised,
          borderWidth: selected ? 2 : 1,
          paddingVertical: spacing[3],
          paddingHorizontal: spacing[4],
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={[
          typography.bodyDefault,
          { color: colors.text.primary, fontWeight: selected ? "700" : "400" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Labelled single-line text field. `latin` is for codes and keys: always
 * left-to-right, whatever the app language. */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
  latin = false,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  latin?: boolean;
  testID?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={[typography.bodyMeta, { color: colors.text.secondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text.tertiary}
        maxLength={maxLength}
        accessibilityLabel={label}
        autoCapitalize={latin ? "characters" : "sentences"}
        autoCorrect={false}
        testID={testID}
        style={[
          styles.input,
          {
            color: colors.text.primary,
            borderColor: colors.border.default,
            backgroundColor: colors.surface.raised,
            fontSize: typography.bodyDefault.fontSize,
            paddingHorizontal: spacing[3],
            textAlign: latin ? "left" : "auto",
            writingDirection: latin ? "ltr" : "auto",
          },
        ]}
      />
    </View>
  );
}

/** Horizontal progress bar; fills from the start edge in either direction. */
export function ProgressBar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  const { colors } = useTheme();
  const fraction = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max, now: value }}
      style={[styles.track, { backgroundColor: colors.surface.sunken }]}
    >
      <View
        style={[
          styles.fill,
          {
            backgroundColor: colors.brand.primary,
            width: `${Math.round(fraction * 100)}%`,
          },
        ]}
      />
    </View>
  );
}

/** Scrolling screen with the app's header (title + back button) and safe-area padding. */
export function ScreenFrame({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title,
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: spacing[4],
          padding: spacing[5],
          paddingBottom: (footer ? spacing[4] : insets.bottom + spacing[6]) + spacing[2],
        }}
      >
        {children}
      </ScrollView>
      {footer ? (
        <View
          style={{
            padding: spacing[4],
            paddingBottom: insets.bottom + spacing[4],
            gap: spacing[3],
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border.default,
            backgroundColor: colors.surface.base,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 14 },
  option: { minHeight: 56, borderRadius: 12, justifyContent: "center" },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10 },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
});
