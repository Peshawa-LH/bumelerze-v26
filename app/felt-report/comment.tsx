import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  enqueueTier2Report,
  TIER2_QUESTION_COUNT,
  useTier2DraftStore,
} from "@/features/felt";
import { ProgressDots } from "@/features/onboarding";
import { useTheme } from "@/theme";

/**
 * Final tier-2 step — optional free-text comment, then submit
 * (spec-v1.md §4.6: "optional comment (feeds the moderated comment
 * stream)"). Photo capture is explicitly NOT in this wave (needs a storage
 * backend) — extension point left below where the photo picker would slot
 * in once `felt_photos` has a real transport to upload to.
 */
export default function Tier2CommentScreen() {
  // `eventId` is accepted on this route (matches every other felt-report
  // screen's param shape) but this screen has no use for it itself — the
  // draft's event association was already recorded via `initDraft` back in
  // the step screens; kept only in the destructured type, not read here.
  const { feltReportId } = useLocalSearchParams<{
    feltReportId: string;
    eventId?: string;
  }>();
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const answers = useTier2DraftStore((state) => state.answers);
  const setAnswer = useTier2DraftStore((state) => state.setAnswer);
  const resetDraft = useTier2DraftStore((state) => state.reset);

  const [comment, setComment] = useState(answers.comment ?? "");
  const [isDone, setIsDone] = useState(false);

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    }
  }

  async function handleSubmit() {
    setAnswer("comment", comment.trim().length > 0 ? comment.trim() : null);
    await enqueueTier2Report({
      feltReportId,
      answers: { ...answers, comment: comment.trim().length > 0 ? comment.trim() : null },
    });
    resetDraft();
    setIsDone(true);
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
      {isDone ? (
        <View style={{ flex: 1, gap: spacing[4], justifyContent: "center" }}>
          <Text
            accessibilityRole="header"
            style={{
              color: colors.text.primary,
              fontSize: typography.h1.fontSize,
              lineHeight: typography.h1.lineHeight,
              fontWeight: typography.h1.fontWeight,
            }}
          >
            {t("felt.tier2.done.title")}
          </Text>
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {t("felt.tier2.done.description")}
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
              {t("felt.tier2.done.close")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.topRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("felt.tier2.back")}
              onPress={handleBack}
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
            <ProgressDots
              totalSteps={TIER2_QUESTION_COUNT + 1}
              currentIndex={TIER2_QUESTION_COUNT}
            />
            <View style={styles.backSlot} />
          </View>
          <ScrollView contentContainerStyle={{ gap: spacing[3], paddingTop: spacing[3] }}>
            <Text
              accessibilityRole="header"
              style={{
                color: colors.text.primary,
                fontSize: typography.h2.fontSize,
                lineHeight: typography.h2.lineHeight,
                fontWeight: typography.h2.fontWeight,
              }}
            >
              {t("felt.tier2.commentTitle")}
            </Text>
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
              }}
            >
              {t("felt.tier2.commentDescription")}
            </Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder={t("felt.tier2.commentPlaceholder")}
              placeholderTextColor={colors.text.tertiary}
              multiline
              accessibilityLabel={t("felt.tier2.commentTitle")}
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
            {/* Extension point (not this wave): optional photo attachment
             * (spec-v1.md §4.6) — needs `felt_photos` + a storage-capable
             * transport (see queue.ts's SupabaseTransport TODO) before a
             * picker can go here. Layout intentionally leaves room below
             * the comment field for it. */}
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
        </>
      )}
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
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 96,
    textAlignVertical: "top",
  },
  primaryButton: {
    borderRadius: 12,
    alignItems: "center",
  },
});
