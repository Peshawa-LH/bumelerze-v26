import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { enqueueFeedback, useFeedbackQueueItemState } from "@/features/feedback";
import { useTheme } from "@/theme";

const MESSAGE_MAX_LENGTH = 4000; // matches feedback.message's CHECK constraint, migration 0020
const CONTACT_MAX_LENGTH = 320; // matches feedback.contact's CHECK constraint, migration 0020

/**
 * Owner directive (see `src/features/feedback/queue.ts`'s own header for
 * the full quote): a Settings-reachable form for daily-use notes and
 * external-tester bug reports, routed to a private Supabase table an
 * uninvolved reviewer never sees. Not a survey — one message field, an
 * optional contact, an optional screenshot, Submit.
 *
 * Uses React Native's built-in `Image` for the screenshot preview
 * thumbnail, not `expo-image` — same reasoning as
 * `app/felt-report/details.tsx`'s own doc comment (a same-session local
 * `file://` uri never needs `expo-image`'s caching/`contentFit`, and
 * `expo-image@57.0.2` crashes under this project's `jest-expo@57.0.3` on a
 * bare import).
 */
export default function FeedbackScreen() {
  const { screen: originScreen } = useLocalSearchParams<{ screen?: string }>();
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  // Reflects the live queue state of the just-submitted item so the
  // confirmation copy stays honest about whether it actually reached the
  // server yet or is still queued locally — same pattern
  // `app/felt-report/done.tsx` uses `useQueueItemState` for.
  const queueState = useFeedbackQueueItemState(submittedId);

  const canSubmit = message.trim().length > 0;

  async function handleAddPhoto() {
    // Aggressive JPEG compression (quality 0.4), library-only, no editing
    // UI — identical policy to `app/felt-report/details.tsx`'s own photo
    // picker (same size-limit rationale: well under the 5 MB bucket cap,
    // migration 0020, without a second native module).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.4,
      allowsEditing: false,
      allowsMultipleSelection: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  function handleRemovePhoto() {
    setPhotoUri(null);
  }

  async function handleSubmit() {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return;
    }
    const trimmedContact = contact.trim();
    const submission = await enqueueFeedback({
      message: trimmedMessage,
      contact: trimmedContact.length > 0 ? trimmedContact : null,
      screen: originScreen ?? null,
      photoUri,
    });
    setSubmittedId(submission.feedbackId);
  }

  function handleClose() {
    if (router.canDismiss()) {
      router.dismiss();
    } else {
      router.back();
    }
  }

  if (submittedId) {
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
            justifyContent: "center",
          },
        ]}
      >
        <Stack.Screen options={{ title: t("feedback.title") }} />
        <View style={{ gap: spacing[4] }}>
          <Text
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            style={{
              color: colors.text.primary,
              fontSize: typography.h1.fontSize,
              lineHeight: typography.h1.lineHeight,
              fontWeight: typography.h1.fontWeight,
            }}
          >
            {t("feedback.confirmation.title")}
          </Text>
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {queueState === "submitted"
              ? t("feedback.confirmation.sentMessage")
              : t("feedback.confirmation.queuedMessage")}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={handleClose}
            style={[
              styles.primaryButton,
              { backgroundColor: colors.brand.primary, paddingVertical: spacing[3] },
            ]}
          >
            <Text
              style={{
                color: colors.brand.onPrimary,
                fontSize: typography.labelButton.fontSize,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {t("feedback.confirmation.close")}
            </Text>
          </Pressable>
        </View>
      </View>
    );
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
      <Stack.Screen options={{ title: t("feedback.title") }} />
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h1.fontSize,
          lineHeight: typography.h1.lineHeight,
          fontWeight: typography.h1.fontWeight,
        }}
      >
        {t("feedback.title")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
          marginTop: spacing[1],
        }}
      >
        {t("feedback.description")}
      </Text>

      <ScrollView contentContainerStyle={{ gap: spacing[3], paddingTop: spacing[4] }}>
        <View style={{ gap: spacing[2] }}>
          <Text
            style={{
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
              fontWeight: "600",
            }}
          >
            {t("feedback.messageLabel")}
          </Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={t("feedback.messagePlaceholder")}
            placeholderTextColor={colors.text.tertiary}
            multiline
            maxLength={MESSAGE_MAX_LENGTH}
            accessibilityLabel={t("feedback.messageLabel")}
            style={[
              styles.input,
              {
                color: colors.text.primary,
                borderColor: colors.border.default,
                backgroundColor: colors.surface.raised,
                fontSize: typography.bodyDefault.fontSize,
                padding: spacing[3],
              },
            ]}
          />
        </View>

        <View style={{ gap: spacing[2] }}>
          <Text
            style={{
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
              fontWeight: "600",
            }}
          >
            {t("feedback.contactLabel")}
          </Text>
          <TextInput
            value={contact}
            onChangeText={setContact}
            placeholder={t("feedback.contactPlaceholder")}
            placeholderTextColor={colors.text.tertiary}
            maxLength={CONTACT_MAX_LENGTH}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t("feedback.contactLabel")}
            style={[
              styles.contactInput,
              {
                color: colors.text.primary,
                borderColor: colors.border.default,
                backgroundColor: colors.surface.raised,
                fontSize: typography.bodyDefault.fontSize,
                paddingHorizontal: spacing[3],
              },
            ]}
          />
        </View>

        {photoUri ? (
          <View style={{ gap: spacing[2] }}>
            <Image
              source={{ uri: photoUri }}
              style={styles.photoPreview}
              accessibilityIgnoresInvertColors
              accessibilityLabel={t("feedback.photo.hint")}
            />
            <Pressable
              accessibilityRole="button"
              onPress={handleRemovePhoto}
              style={styles.secondaryButton}
            >
              <Text
                style={{
                  color: colors.text.link,
                  fontSize: typography.labelButton.fontSize,
                  fontWeight: typography.labelButton.fontWeight,
                }}
              >
                {t("feedback.photo.removeLabel")}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityHint={t("feedback.photo.hint")}
            onPress={() => void handleAddPhoto()}
            style={[styles.photoButton, { borderColor: colors.border.default }]}
          >
            <Text
              style={{
                color: colors.text.link,
                fontSize: typography.labelButton.fontSize,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {t("feedback.photo.addLabel")}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={() => void handleSubmit()}
        style={[
          styles.primaryButton,
          {
            backgroundColor: canSubmit ? colors.brand.primary : colors.surface.raised,
            paddingVertical: spacing[3],
          },
        ]}
      >
        <Text
          style={{
            color: canSubmit ? colors.brand.onPrimary : colors.text.tertiary,
            fontSize: typography.labelButton.fontSize,
            fontWeight: typography.labelButton.fontWeight,
          }}
        >
          {t("feedback.submit")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 140,
    textAlignVertical: "top",
  },
  contactInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
  },
  photoPreview: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 10,
  },
  photoButton: {
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryButton: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
});
