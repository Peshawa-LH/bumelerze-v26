import { Text } from "react-native";

import { useTheme } from "@/theme";

/** The one red line under an auth form. Renders nothing without a message. */
export function AuthErrorText({
  text,
  testID,
}: {
  text: string | null;
  testID?: string;
}) {
  const { colors, typography } = useTheme();
  if (!text) {
    return null;
  }
  return (
    <Text
      accessibilityRole="alert"
      testID={testID}
      style={{
        color: colors.status.danger,
        fontSize: typography.bodyDefault.fontSize,
        lineHeight: typography.bodyDefault.lineHeight,
      }}
    >
      {text}
    </Text>
  );
}
