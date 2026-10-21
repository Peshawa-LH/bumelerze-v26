import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KEYBOARD_AWARE_SCROLL } from "@/lib/keyboard-scroll";
import { useTheme } from "@/theme";
import { useTextDir } from "./text-dir";

/**
 * The body every admin tool page shares (review 15.3): one centred column
 * (at most 560 wide), the same padding and gaps, an optional one-line hint
 * on top and an optional footer note at the bottom. Symmetric paddings only,
 * so it reads the same in Sorani and Arabic.
 */
export function ToolPage({
  hint,
  footer,
  children,
  testID,
}: {
  hint?: string | undefined;
  footer?: string | undefined;
  children: ReactNode;
  testID?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const dir = useTextDir();
  const meta = [typography.bodyMeta, dir, { color: colors.text.secondary }];
  return (
    <ScrollView
      {...KEYBOARD_AWARE_SCROLL}
      testID={testID}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[4],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      {hint ? (
        <Text style={meta} testID={testID ? `${testID}-hint` : undefined}>
          {hint}
        </Text>
      ) : null}
      {children}
      {footer ? (
        <Text
          style={[meta, styles.footer, { color: colors.text.tertiary }]}
          testID={testID ? `${testID}-footer` : undefined}
        >
          {footer}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
  footer: { textAlign: "center" },
});
