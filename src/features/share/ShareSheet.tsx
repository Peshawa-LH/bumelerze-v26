import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEventSourceAgencies, type Event } from "@/features/events";
import { magnitudeTone } from "@/features/events/magnitude-tone";
import { useResolvedShakeMap } from "@/features/shakemap/live-queries";
import { useTheme } from "@/theme";
import { lightColors } from "@/theme/semantic";

import { buildCardModel, type CardModel } from "./card-layout";
import { buildCardStrings } from "./card-strings";
import { buildShareCaption, buildShareUrl, ensureLinkInText } from "./caption";
import { CardRenderer, type CardRendererHandle } from "./CardRenderer";
import { deliverImage } from "./image-export";
import { copyText, shareText } from "./share-text";
import { SHARE_CARD_SIZES, type ShareCardSize, type ShareImage } from "./types";

/** Web images are prepared right after the sheet opens, once its opening
 * transition is over, so a tap can call the browser's share dialog at once
 * (it needs a live user gesture and cannot wait for rendering). */
const WEB_PREPARE_DELAY_MS = 250;
const WIDE_WEB_MIN_WIDTH = 600;

type StatusKey =
  "share.linkCopied" | "share.captionCopied" | "share.imageSaved" | "share.imageFailed";

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduce(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return reduce;
}

interface ImageBatch {
  /** The `buildModel` these images were made from. */
  model: ((size: ShareCardSize) => CardModel) | null;
  images: Partial<Record<ShareCardSize, ShareImage>>;
  /** Web only: every image has been attempted. */
  done: boolean;
}

export interface ShareSheetProps {
  event: Event;
  /** Id for the link: the Bumelerze id when known, else the event's own id. */
  shareId: string;
  onClose: () => void;
}

/**
 * "Share this earthquake": a small sheet with the editable caption and three
 * actions, share the link, or share the image as a square post or a tall
 * story. Images are generated only when asked for: on the phone at the tap
 * (with a spinner), on the web as soon as the sheet opens (the browser's
 * share dialog must be called synchronously from the tap).
 */
export function ShareSheet({ event, shareId, onClose }: ShareSheetProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();
  const centered = Platform.OS === "web" && width >= WIDE_WEB_MIN_WIDTH;
  const isWeb = Platform.OS === "web";

  const shake = useResolvedShakeMap(event, true);
  const agencies = useEventSourceAgencies([event]).get(event.id)?.agencies;
  const url = buildShareUrl(shareId);

  const [caption, setCaption] = useState(() =>
    buildShareCaption({ event, shareId, locale, t }),
  );
  const [status, setStatus] = useState<StatusKey | null>(null);
  const [busySize, setBusySize] = useState<ShareCardSize | null>(null);
  const [batch, setBatch] = useState<ImageBatch>({
    model: null,
    images: {},
    done: false,
  });
  const rendererRef = useRef<CardRendererHandle | null>(null);

  const contours = shake.contours;
  const reviewStatus = shake.product?.reviewStatus ?? null;
  const epicenter = contours?.epicenter ?? { lat: event.lat, lon: event.lon };
  const epicenterLat = epicenter.lat;
  const epicenterLon = epicenter.lon;
  const agencyKey = (agencies ?? []).join(",");

  // The card is rebuilt only when something it shows changes.
  const buildModel = useCallback(
    (size: ShareCardSize): CardModel =>
      buildCardModel({
        size,
        locale,
        strings: buildCardStrings({
          event,
          locale,
          t,
          agencies: agencyKey === "" ? undefined : agencyKey.split(","),
          reviewStatus: contours ? reviewStatus : null,
        }),
        magnitudeValue: event.magnitude.value,
        epicenter: { lat: epicenterLat, lon: epicenterLon },
        contours,
        url,
        colors: lightColors,
        magnitudeBandColor:
          lightColors.magnitudeBand[magnitudeTone(event.magnitude.value)],
      }),
    [
      event,
      locale,
      t,
      agencyKey,
      contours,
      reviewStatus,
      epicenterLat,
      epicenterLon,
      url,
    ],
  );

  // Images belong to the card they were made from: when the data behind the
  // card changes (the shakemap can arrive after the sheet opens) they are
  // simply no longer "current" and get made again.
  const current = batch.model === buildModel ? batch : null;
  const images = current?.images ?? {};
  const preparing = isWeb && !current?.done;

  // Web: prepare both images up front (see WEB_PREPARE_DELAY_MS).
  useEffect(() => {
    if (!isWeb) {
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      (async () => {
        const made: Partial<Record<ShareCardSize, ShareImage>> = {};
        try {
          for (const size of SHARE_CARD_SIZES) {
            const image = await rendererRef.current?.render(size);
            if (stale || !image) return;
            made[size] = image;
            setBatch({ model: buildModel, images: { ...made }, done: false });
          }
        } catch {
          if (!stale) setStatus("share.imageFailed");
        } finally {
          if (!stale) setBatch({ model: buildModel, images: { ...made }, done: true });
        }
      })();
    }, WEB_PREPARE_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [isWeb, buildModel]);

  const handleShareLink = async () => {
    setStatus(null);
    const outcome = await shareText(ensureLinkInText(caption, url), t("share.title"));
    if (outcome === "copied") setStatus("share.linkCopied");
  };

  const handleCopyCaption = async () => {
    setStatus((await copyText(caption)) ? "share.captionCopied" : null);
  };

  const handleShareImage = async (size: ShareCardSize) => {
    if (busySize) return;
    setStatus(null);
    const request = {
      fileName: `bumelerze-${shareId}-${size}.png`,
      caption,
      title: t("share.title"),
    };
    try {
      let image = images[size];
      if (!image) {
        setBusySize(size);
        image = await rendererRef.current?.render(size);
        if (!image) throw new Error("no image");
        const made = image;
        setBatch((previous) => ({
          model: buildModel,
          images: {
            ...(previous.model === buildModel ? previous.images : {}),
            [size]: made,
          },
          done: previous.model === buildModel && previous.done,
        }));
      }
      const outcome = await deliverImage(image, request);
      if (outcome === "downloaded") setStatus("share.imageSaved");
      if (outcome === "unavailable") setStatus("share.imageFailed");
    } catch {
      setStatus("share.imageFailed");
    } finally {
      setBusySize(null);
    }
  };

  const labelStyle = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    lineHeight: typography.labelCaption.lineHeight,
    fontWeight: typography.labelCaption.fontWeight,
  } as const;

  const imageButtons: {
    size: ShareCardSize;
    label: string;
    icon: "square-outline" | "phone-portrait-outline";
  }[] = [
    { size: "square", label: t("share.imageSquare"), icon: "square-outline" },
    { size: "story", label: t("share.imageStory"), icon: "phone-portrait-outline" },
  ];

  return (
    <Modal
      testID="share-sheet-modal"
      visible
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.root, centered ? styles.rootWeb : styles.rootNative]}>
        <Pressable
          testID="share-sheet-scrim"
          accessibilityRole="button"
          accessibilityLabel={t("share.close")}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface.overlay }]}
        />
        <View
          testID="share-sheet"
          style={[
            styles.panel,
            centered ? styles.panelWeb : styles.panelNative,
            {
              backgroundColor: colors.surface.raised,
              borderColor: colors.border.default,
            },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: spacing[5],
              paddingBottom: spacing[5] + (centered ? 0 : insets.bottom),
              gap: spacing[3],
            }}
          >
            <View style={styles.titleRow}>
              <Text
                accessibilityRole="header"
                style={[typography.h3, styles.title, { color: colors.text.primary }]}
              >
                {t("share.title")}
              </Text>
              <Pressable
                testID="share-sheet-close"
                accessibilityRole="button"
                accessibilityLabel={t("share.close")}
                onPress={onClose}
                hitSlop={8}
                style={styles.close}
              >
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </Pressable>
            </View>

            <View style={{ gap: spacing[1] }}>
              <Text style={labelStyle}>{t("share.captionLabel")}</Text>
              <TextInput
                testID="share-caption-input"
                accessibilityLabel={t("share.captionLabel")}
                value={caption}
                onChangeText={setCaption}
                multiline
                style={[
                  typography.bodyDefault,
                  styles.input,
                  {
                    color: colors.text.primary,
                    backgroundColor: colors.surface.base,
                    borderColor: colors.border.default,
                    padding: spacing[3],
                  },
                ]}
              />
            </View>

            <ActionButton
              testID="share-link"
              label={t("share.link")}
              icon="link-outline"
              primary
              onPress={handleShareLink}
            />
            {imageButtons.map(({ size, label, icon }) => {
              const ready = Boolean(images[size]);
              const busy = busySize === size || (isWeb && preparing && !ready);
              return (
                <ActionButton
                  key={size}
                  testID={`share-image-${size}`}
                  label={label}
                  icon={icon}
                  busy={busy}
                  disabled={busySize !== null || (isWeb && !ready)}
                  onPress={() => handleShareImage(size)}
                />
              );
            })}
            {/* Instagram and TikTok take the picture only; the caption then
             * has to be pasted, so copying it is always one tap away. */}
            <ActionButton
              testID="share-copy-caption"
              label={t("share.copyCaption")}
              icon="copy-outline"
              quiet
              onPress={handleCopyCaption}
            />

            <View accessibilityLiveRegion="polite" style={styles.statusRow}>
              {busySize || (isWeb && preparing) ? (
                <Text testID="share-preparing" style={labelStyle}>
                  {t("share.preparing")}
                </Text>
              ) : status ? (
                <Text testID="share-status" style={labelStyle}>
                  {t(status)}
                </Text>
              ) : null}
            </View>
          </ScrollView>
        </View>
        <CardRenderer ref={rendererRef} buildModel={buildModel} />
      </View>
    </Modal>
  );
}

function ActionButton({
  testID,
  label,
  icon,
  primary = false,
  quiet = false,
  busy = false,
  disabled = false,
  onPress,
}: {
  testID: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary?: boolean;
  quiet?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, typography, spacing } = useTheme();
  const foreground = primary ? colors.brand.onPrimary : colors.brand.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: 52,
          paddingHorizontal: spacing[4],
          gap: spacing[2],
          backgroundColor: primary ? colors.brand.primary : "transparent",
          borderColor: quiet ? "transparent" : colors.brand.primary,
          opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <Ionicons name={icon} size={22} color={foreground} />
      )}
      <Text
        style={{
          color: foreground,
          fontSize: typography.labelButton.fontSize,
          lineHeight: typography.labelButton.lineHeight,
          fontWeight: typography.labelButton.fontWeight,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootNative: { justifyContent: "flex-end" },
  rootWeb: { justifyContent: "center", alignItems: "center" },
  panel: { width: "100%", borderWidth: 1, maxHeight: "92%" },
  panelNative: { borderTopStartRadius: 20, borderTopEndRadius: 20 },
  panelWeb: { maxWidth: 440, borderRadius: 20 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { flex: 1 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 132, textAlignVertical: "top" },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderRadius: 14,
  },
  statusRow: { minHeight: 22 },
});
