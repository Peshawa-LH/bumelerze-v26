import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { PASSWORD_MAX_LENGTH } from "../constants";

export type AuthFieldKind = "email" | "newPassword" | "currentPassword";

interface AuthFieldProps {
  kind: AuthFieldKind;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Quiet helper line under the field. */
  hint?: string;
  placeholder?: string;
  testID: string;
  onSubmitEditing?: () => void;
  returnKeyType?: "next" | "done" | "go";
  editable?: boolean;
}

/**
 * One labelled input for the sign-in forms. Email and password text is always
 * a left-to-right run, even in Sorani and Arabic, so the text itself is
 * isolated (`writingDirection: ltr`) while the box and the show/hide button
 * still follow the screen direction. The autofill hints (`autoComplete` for
 * Android and web, `textContentType` for iOS) are what let password managers
 * offer to save and fill.
 */
export function AuthField({
  kind,
  label,
  value,
  onChangeText,
  hint,
  placeholder,
  testID,
  onSubmitEditing,
  returnKeyType,
  editable = true,
}: AuthFieldProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [shown, setShown] = useState(false);
  const isPassword = kind !== "email";

  const hints =
    kind === "email"
      ? ({ autoComplete: "email", textContentType: "emailAddress" } as const)
      : kind === "newPassword"
        ? ({ autoComplete: "new-password", textContentType: "newPassword" } as const)
        : ({ autoComplete: "current-password", textContentType: "password" } as const);

  return (
    <View style={{ gap: spacing[1] }}>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
      <View
        style={[
          styles.box,
          {
            borderColor: colors.border.default,
            backgroundColor: colors.surface.raised,
            paddingStart: spacing[3],
          },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.text.tertiary}
          accessibilityLabel={label}
          keyboardType={kind === "email" ? "email-address" : "default"}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          secureTextEntry={isPassword && !shown}
          maxLength={isPassword ? PASSWORD_MAX_LENGTH : 254}
          editable={editable}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          {...hints}
          style={[
            styles.input,
            { color: colors.text.primary, fontSize: typography.bodyDefault.fontSize },
          ]}
          testID={testID}
        />
        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              shown ? "account.signIn.hidePassword" : "account.signIn.showPassword",
            )}
            onPress={() => setShown((current) => !current)}
            style={styles.toggle}
            testID={`${testID}-toggle`}
          >
            <Ionicons
              name={shown ? "eye-off-outline" : "eye-outline"}
              size={22}
              color={colors.text.secondary}
            />
          </Pressable>
        ) : null}
      </View>
      {hint ? (
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 52,
  },
  input: {
    flex: 1,
    minHeight: 50,
    // Email addresses and passwords are left-to-right runs in every locale.
    textAlign: "left",
    writingDirection: "ltr",
  },
  toggle: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
