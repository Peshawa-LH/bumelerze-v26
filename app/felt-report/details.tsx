import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { enqueueTier2Report, useTier2DraftStore } from "@/features/felt";
import { useTheme } from "@/theme";

/**
 * Window 3 of 3 — optional comment + photo, then Submit (2026-08-15 flow
 * restructure, owner directive). Submitting here completes the BASELINE
 * report (damage from window 2 + whatever's collected on this screen) —
 * the questionnaire behind "Add more detail" is a further, still-optional
 * upgrade on top of this same submission, not a requirement to reach it.
 *
 * Uses React Native's built-in `Image`, not `expo-image`, for the photo
 * preview thumbnail: `LevelTile.tsx`'s own doc comment documents that
 * `expo-image@57.0.2` currently crashes under this project's
 * `jest-expo@57.0.3` on a bare import — pulling it in here would break this
 * screen's own test suite for a preview thumbnail that doesn't need
 * `expo-image`'s caching/`contentFit` features (it's a same-session local
 * file:// URI, never a remote/cached one). Revisit once that incompatibility
 * is resolved.
 */
export default function DetailsReportScreen() {
  const { feltReportId, eventId } = useLocalSearchParams<{
    feltReportId: string;
    eventId?: string;
  }>();
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const answers = useTier2DraftStore((state) => state.answers);
  const setAnswer = useTier2DraftStore((state) => state.setAnswer);
  const photoUri = useTier2DraftStore((state) => state.photoUri);
  const setPhotoUri = useTier2DraftStore((state) => state.setPhotoUri);
  const resetDraft = useTier2DraftStore((state) => state.reset);
  const initDraft = useTier2DraftStore((state) => state.initDraft);

  const [comment, setComment] = useState(answers.comment ?? "");

  useEffect(() => {
    if (feltReportId) {
      initDraft(feltReportId, eventId || null);
    }
  }, [feltReportId, eventId, initDraft]);

  function commitComment() {
    setAnswer("comment", comment.trim().length > 0 ? comment.trim() : null);
  }

  async function handleAddPhoto() {
    // Aggressive JPEG compression (quality 0.4) is this wave's size-limit
    // mechanism — keeps a typical phone photo well under ~2MB without
    // pulling in a second native module (expo-image-manipulator) just for
    // dimension-based resizing (wave brief: "aggressive size limit ~2MB
    // with resize"). Library first (most common path), no editing UI (a
    // felt report shouldn't ask the user to crop anything mid-aftershock).
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

  function handleAddMoreDetail() {
    commitComment();
    router.push({
      pathname: "/felt-report/step/[step]",
      params: { step: "0", feltReportId, eventId: eventId ?? "" },
    });
  }

  async function handleSubmit() {
    commitComment();
    const finalComment = comment.trim().length > 0 ? comment.trim() : null;
    await enqueueTier2Report({
      feltReportId,
      answers: { ...answers, comment: finalComment },
      photoUri,
    });
    resetDraft();
    router.replace({
      pathname: "/felt-report/done",
      params: { feltReportId, eventId: eventId ?? "" },
    });
  }

  function handleClose() {
    resetDraft();
    if (router.canDismiss()) {
      router.dismiss();
    } else {
      router.back();
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
        <Text
          accessibilityRole="header"
          style={{
            color: colors.text.primary,
            fontSize: typography.h1.fontSize,
            lineHeight: typography.h1.lineHeight,
            fontWeight: typography.h1.fontWeight,
          }}
        >
          {t("felt.details.title")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("felt.tier1.close")}
          onPress={handleClose}
          hitSlop={12}
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("felt.tier1.close")}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ gap: spacing[3], paddingTop: spacing[3] }}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {t("felt.details.commentDescription")}
        </Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          onBlur={commitComment}
          placeholder={t("felt.details.commentPlaceholder")}
          placeholderTextColor={colors.text.tertiary}
          multiline
          accessibilityLabel={t("felt.details.title")}
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

        {photoUri ? (
          <View style={{ gap: spacing[2] }}>
            <Image
              source={{ uri: photoUri }}
              style={styles.photoPreview}
              accessibilityIgnoresInvertColors
              accessibilityLabel={t("felt.details.photo.hint")}
            />
            <Pressable
              accessibilityRole="button"
              onPress={handleRemovePhoto}
              style={styles.addMoreDetailButton}
            >
              <Text
                style={{
                  color: colors.text.link,
                  fontSize: typography.labelButton.fontSize,
                  fontWeight: typography.labelButton.fontWeight,
                }}
              >
                {t("felt.details.photo.removeLabel")}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityHint={t("felt.details.photo.hint")}
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
              {t("felt.details.photo.addLabel")}
            </Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={handleAddMoreDetail}
          style={styles.addMoreDetailButton}
        >
          <Text
            style={{
              color: colors.text.link,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t("felt.details.addMoreDetail")}
          </Text>
        </Pressable>
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        onPress={() => void handleSubmit()}
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
          {t("felt.tier2.submit")}
        </Text>
      </Pressable>
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
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 96,
    textAlignVertical: "top",
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
  addMoreDetailButton: {
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
