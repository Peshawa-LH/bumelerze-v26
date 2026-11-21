import { Platform, StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme, nativeFontFamily, READING_START } from "@/theme";
import { TWO_STEP_CODE_LENGTH, normalizeTwoStepCode } from "../two-step";

interface CodeFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  editable?: boolean;
  testID: string;
}

/**
 * The 6-digit code from an authenticator app, in big digits. Only digits
 * are kept: Sorani/Arabic keyboard digits become the ASCII digits the app
 * shows, and spaces from a pasted "123 456" go. The code is a left-to-right
 * run in every language. The autofill hints let iOS and Android offer a
 * code from a password manager that holds the key.
 */
export function CodeField({
  label,
  value,
  onChangeText,
  onSubmitEditing,
  editable = true,
  testID,
}: CodeFieldProps) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing[1] }}>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          fontFamily: nativeFontFamily(typography.bodyDefault, "600"),
          ...READING_START,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={(text) =>
          onChangeText(normalizeTwoStepCode(text).slice(0, TWO_STEP_CODE_LENGTH))
        }
        accessibilityLabel={label}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        editable={editable}
        onSubmitEditing={onSubmitEditing}
        returnKeyType="go"
        style={[
          styles.input,
          {
            borderColor: colors.border.default,
            backgroundColor: colors.surface.raised,
            color: colors.text.primary,
          },
        ]}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 60,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center",
    writingDirection: "ltr",
    fontVariant: ["tabular-nums"],
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
});
