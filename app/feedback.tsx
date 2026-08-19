import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FEEDBACK_PHOTO_MAX_COUNT, enqueueFeedback, useFeedbackQueueItemState } from "@/features/feedback";
import { useTheme } from "@/theme";

const MESSAGE_MAX_LENGTH = 4000; // matches feedback.message's CHECK constraint, migration 0020
const CONTACT_MAX_LENGTH = 320; // matches feedback.contact's CHECK constraint, migration 0020

/** One screenshot as picked, before submission — a purely LOCAL id
 * (`Crypto.randomUUID()`, distinct from the eventual `feedback_photos.
 * photo_id` `enqueueFeedback` generates) just so React has a stable key
 * and each thumbnail/remove-button pair can carry its own accessible
 * label without relying on array index (which would shift under removal). */
interface PickedPhoto {
  id: string;
  uri: string;
}

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
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  // Reflects the live queue state of the just-submitted item so the
  // confirmation copy stays honest about whether it actually reached the
  // server yet or is still queued locally — same pattern
  // `app/felt-report/done.tsx` uses `useQueueItemState` for.
  const queueState = useFeedbackQueueItemState(submittedId);

  const canSubmit = message.trim().length > 0;
  const atPhotoLimit = photos.length >= FEEDBACK_PHOTO_MAX_COUNT;

  async function handleAddPhoto() {
    // Aggressive JPEG compression (quality 0.4), library-only, no editing
    // UI — identical policy to `app/felt-report/details.tsx`'s own photo
    // picker (same size-limit rationale: well under the 5 MB bucket cap,
    // migration 0020, without a second native module). Multi-select where
    // the platform supports it; a second (or third) tap on "Add more" lets
    // a user top up the set later, since a tester often remembers another
    // screenshot after the first pass — `photos` only ever grows via
    // append, never a full replace, across calls.
    const remainingSlots = FEEDBACK_PHOTO_MAX_COUNT - photos.length;
    if (remainingSlots <= 0) {
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.4,
      allowsEditing: false,
      allowsMultipleSelection: true,
      // iOS honors this directly; Android/web may still return more than
      // this, so the slice below is the real enforcement everywhere.
      selectionLimit: remainingSlots,
    });
    if (result.canceled) {
      return;
    }
    const picked: PickedPhoto[] = result.assets
      .slice(0, remainingSlots)
      .map((asset) => ({ id: Crypto.randomUUID(), uri: asset.uri }));
    setPhotos((current) => [...current, ...picked]);
  }

  function handleRemovePhoto(id: string) {
    setPhotos((current) => current.filter((photo) => photo.id !== id));
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
      photoUris: photos.map((photo) => photo.uri),
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

        <View style={{ gap: spacing[2] }}>
          <Text
            style={{
              color: colors.text.primary,
              fontSize: typography.bodyDefault.fontSize,
              fontWeight: "600",
            }}
          >
            {t("feedback.photo.label")}
          </Text>

          {photos.length > 0 ? (
            <View style={styles.thumbnailGrid}>
              {photos.map((photo, index) => (
                <View key={photo.id} style={styles.thumbnailWrapper}>
                  <Image
                    source={{ uri: photo.uri }}
                    style={styles.thumbnail}
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={t("feedback.photo.thumbnailLabel", {
                      index: index + 1,
                      count: photos.length,
                    })}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("feedback.photo.removeThumbnailLabel", {
                      index: index + 1,
                    })}
                    onPress={() => handleRemovePhoto(photo.id)}
                    hitSlop={8}
                    style={[
                      styles.removeBadge,
                      { backgroundColor: colors.surface.base, borderColor: colors.border.default },
                    ]}
                  >
                    <Text
                      style={{ color: colors.text.primary, fontSize: typography.labelCaption.fontSize }}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      {t("feedback.photo.removeSymbol")}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {atPhotoLimit ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
              }}
            >
              {t("feedback.photo.limitReached", { count: FEEDBACK_PHOTO_MAX_COUNT })}
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityHint={t("feedback.photo.hint", { max: FEEDBACK_PHOTO_MAX_COUNT })}
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
                {photos.length > 0 ? t("feedback.photo.addMoreLabel") : t("feedback.photo.addLabel")}
              </Text>
            </Pressable>
          )}
        </View>
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
  thumbnailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  thumbnailWrapper: {
    width: 84,
    height: 84,
  },
  thumbnail: {
    width: "100%",
    height: "100%",
    borderRadius: 10,
  },
  removeBadge: {
    position: "absolute",
    top: -6,
    end: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  photoButton: {
    borderWidth: 1,
    borderRadius: 10,
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
