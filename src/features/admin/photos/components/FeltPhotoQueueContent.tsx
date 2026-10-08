import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSnackbar } from "@/components/Snackbar";
import { formatAbsoluteDual } from "@/features/events";
import { formatMagnitudeValue, isolateNumeric } from "@/features/events/format";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { formatIntensity } from "@/features/shakemap";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme } from "@/theme";
import { useAdminAccess } from "../../queries";
import { inboxErrorText } from "../../inbox/error-text";
import { usePhotoActions, usePhotoQueue, useSignedPhotos } from "../queries";
import {
  PHOTO_STATUSES,
  type PhotoQueueTransport,
  type PhotoStatus,
  type QueuePhoto,
} from "../transport";

/**
 * Admin > Felt photos (migration 0060, decision D15): photos attached to felt
 * reports stay hidden until someone approves them. Pending photos come oldest
 * first; each card shows the photo, when the report was made, the earthquake
 * and the intensity picked, never a location or who sent it. Approve, or
 * Reject (asks first; the file is then deleted). Gated by `photos.moderate`
 * (moderators too) inside; a stray link shows nothing.
 */
export function FeltPhotoQueueContent({
  transport,
  hubTransport,
}: {
  transport?: PhotoQueueTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const access = useAdminAccess(hubTransport);
  const [status, setStatus] = useState<PhotoStatus>("pending");
  const queue = usePhotoQueue(status, access.canModeratePhotos, transport);
  const photos: QueuePhoto[] = useMemo(
    () => (queue.data?.pages ?? []).flat(),
    [queue.data],
  );
  const paths = useMemo(() => photos.map((p) => p.storagePath), [photos]);
  const signed = useSignedPhotos(paths, transport);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (!access.canModeratePhotos) {
    return access.isLoading ? null : (
      <View style={{ padding: spacing[4] }}>
        <Text style={meta} testID="photos-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      testID="admin-photos"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[3],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      <Text style={meta}>{t("admin.photos.hint")}</Text>
      <View style={styles.row} accessibilityRole="radiogroup">
        {PHOTO_STATUSES.map((candidate) => (
          <ActionButton
            key={candidate}
            label={t(`admin.photos.tabs.${candidate}`)}
            selected={status === candidate}
            onPress={() => setStatus(candidate)}
            testID={`photos-tab-${candidate}`}
          />
        ))}
      </View>

      {queue.isLoading ? (
        <Text style={meta} testID="photos-loading">
          {t("eventDetail.loading")}
        </Text>
      ) : queue.isError ? (
        <View style={{ gap: spacing[1] }}>
          <Text
            accessibilityRole="alert"
            style={[meta, { color: colors.status.danger }]}
            testID="photos-error"
          >
            {inboxErrorText(t, queue.error)}
          </Text>
          <ActionButton
            label={t("events.retry")}
            onPress={() => void queue.refetch()}
            testID="photos-retry"
          />
        </View>
      ) : photos.length === 0 ? (
        <Text style={meta} testID="photos-empty">
          {t(`admin.photos.empty.${status}`)}
        </Text>
      ) : (
        photos.map((photo) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            url={signed.data?.get(photo.storagePath) ?? null}
            {...(transport ? { transport } : {})}
          />
        ))
      )}

      {queue.hasNextPage ? (
        <ActionButton
          label={
            queue.isFetchingNextPage
              ? t("eventDetail.loading")
              : t("admin.activity.loadMore")
          }
          disabled={queue.isFetchingNextPage}
          onPress={() => void queue.fetchNextPage()}
          testID="photos-load-more"
        />
      ) : null}
    </ScrollView>
  );
}

function PhotoCard({
  photo,
  url,
  transport,
}: {
  photo: QueuePhoto;
  url: string | null;
  transport?: PhotoQueueTransport;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const snackbar = useSnackbar();
  const { colors, typography, spacing } = useTheme();
  const actions = usePhotoActions(transport);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const language = i18n.language;
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const when = (value: number) => formatAbsoluteDual(value, language, t).local;

  const event = [
    photo.place,
    photo.magnitude !== null
      ? isolateNumeric(
          t("events.magnitudeDisplay", {
            value: formatMagnitudeValue(photo.magnitude, language),
          }),
        )
      : null,
    photo.originTime !== null ? when(photo.originTime) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const report = [
    photo.intensity !== null
      ? t("admin.photos.intensity", { level: formatIntensity(photo.intensity, language) })
      : null,
    photo.reportedAt !== null
      ? t("admin.photos.reported", { date: when(photo.reportedAt) })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const decided =
    photo.status !== "pending" && photo.moderatedAt !== null
      ? t(`admin.photos.decided.${photo.status}`, {
          date: when(photo.moderatedAt),
          name: photo.moderatedByName ?? t("admin.photos.someone"),
        })
      : null;

  async function approve() {
    setBusy(true);
    setErrorText(null);
    try {
      await actions.approve(photo.id);
      snackbar.show({ message: t("admin.photos.approved") });
    } catch (error) {
      setErrorText(inboxErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  function reject() {
    confirmDialog({
      title: t("admin.photos.rejectTitle"),
      message: t("admin.photos.rejectMessage"),
      confirmLabel: t("admin.photos.reject"),
      cancelLabel: t("eventHub.thread.cancel"),
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setBusy(true);
          setErrorText(null);
          try {
            const removed = await actions.reject(photo.id, null);
            if (removed) {
              snackbar.show({ message: t("admin.photos.rejected") });
            } else {
              setErrorText(t("admin.photos.errors.fileKept"));
            }
          } catch (error) {
            setErrorText(inboxErrorText(t, error));
          } finally {
            setBusy(false);
          }
        })();
      },
    });
  }

  return (
    <View
      testID={`photo-${photo.id}`}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[2],
        },
      ]}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          contentFit="contain"
          accessibilityLabel={t("admin.photos.photoLabel")}
          style={[styles.photo, { backgroundColor: colors.surface.sunken }]}
          testID={`photo-image-${photo.id}`}
        />
      ) : (
        <Text
          style={[meta, { fontStyle: "italic" }]}
          testID={`photo-no-image-${photo.id}`}
        >
          {photo.status === "rejected"
            ? t("admin.photos.fileRemoved")
            : t("admin.photos.noImage")}
        </Text>
      )}
      {event ? (
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            fontWeight: "600",
          }}
          testID={`photo-event-${photo.id}`}
        >
          {event}
        </Text>
      ) : (
        <Text style={meta}>{t("admin.photos.noEvent")}</Text>
      )}
      {report ? (
        <Text style={meta} testID={`photo-report-${photo.id}`}>
          {report}
        </Text>
      ) : null}
      {decided ? <Text style={meta}>{decided}</Text> : null}
      <View style={styles.row}>
        {photo.hubId ? (
          <ActionButton
            label={t("admin.queue.open")}
            onPress={() => router.push(`/event-hub/${photo.hubId as string}`)}
            testID={`photo-open-${photo.id}`}
          />
        ) : null}
        {photo.status === "pending" ? (
          <ActionButton
            label={t("admin.photos.approve")}
            disabled={busy}
            onPress={() => void approve()}
            testID={`photo-approve-${photo.id}`}
          />
        ) : null}
        {photo.status !== "rejected" ? (
          <ActionButton
            label={t("admin.photos.reject")}
            disabled={busy}
            onPress={reject}
            testID={`photo-reject-${photo.id}`}
          />
        ) : url ? (
          <ActionButton
            label={t("admin.photos.removeFile")}
            disabled={busy}
            onPress={reject}
            testID={`photo-remove-file-${photo.id}`}
          />
        ) : null}
      </View>
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID={`photo-error-${photo.id}`}
        >
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  card: { borderWidth: 1, borderRadius: 12 },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: 8 },
});
