import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Event } from "@/features/events";
import type { GuidelinesTransport } from "@/features/guidelines";
import type { PostsTransport } from "@/features/posts/transport";
import { useTheme } from "@/theme";

import type { CardModel } from "./card-layout";
import { buildShareCaption, buildShareUrl, ensureLinkInText } from "./caption";
import { CardRenderer, type CardRendererHandle } from "./CardRenderer";
import { deliverImage } from "./image-export";
import { PostToProfileAction } from "./PostToProfileAction";
import { ShareActionButton } from "./ShareActionButton";
import { copyText, shareText } from "./share-text";
import { SHARE_CARD_SIZES, type ShareCardSize, type ShareImage } from "./types";
import { useShareCardModel } from "./use-card-model";

/** Web images are prepared right after the sheet opens, once its opening
 * transition is over, so a tap can call the browser's share dialog at once
 * (it needs a live user gesture and cannot wait for rendering). */
const WEB_PREPARE_DELAY_MS = 250;
const WIDE_WEB_MIN_WIDTH = 600;
/** The caption box is never shorter than this, and grows with its text (the
 * five Sorani lines were cut off at a fixed height, review A-14). */
const CAPTION_MIN_HEIGHT = 132;

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
  /** The event's `bml` id (or registry id) for "Post to my profile"; that
   * option hides while it is unknown. */
  profileRef?: string | null;
  onClose: () => void;
  /** Tests inject fakes. */
  postsTransport?: PostsTransport;
  guidelinesTransport?: GuidelinesTransport;
}

/**
 * "Share this earthquake": a small sheet with the editable caption and its
 * actions: share the link, share the image as a square post or a tall story,
 * and (for an account with a @username) post it to my profile with the same
 * caption. Images are generated only when asked for: on the phone at the tap
 * (with a spinner), on the web as soon as the sheet opens (the browser's
 * share dialog must be called synchronously from the tap).
 */
export function ShareSheet({
  event,
  shareId,
  profileRef = null,
  onClose,
  postsTransport,
  guidelinesTransport,
}: ShareSheetProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();
  const centered = Platform.OS === "web" && width >= WIDE_WEB_MIN_WIDTH;
  const isWeb = Platform.OS === "web";

  const url = buildShareUrl(shareId);
  const buildModel = useShareCardModel(event, shareId);

  const [caption, setCaption] = useState(() =>
    buildShareCaption({ event, shareId, locale, t }),
  );
  const [status, setStatus] = useState<StatusKey | null>(null);
  // The height the caption box needs to show every line (0 = not measured).
  const [captionBoxHeight, setCaptionBoxHeight] = useState(0);
  const captionPadding = spacing[3];
  // Memoised: react-native-web re-measures whenever this handler changes,
  // and the web's measurement (the box's scroll height) already includes
  // the padding; adding it again grew the box on every pass, without end.
  const onCaptionContentSizeChange = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const measured = event.nativeEvent.contentSize.height;
      const next = Platform.OS === "web" ? measured : measured + captionPadding * 2;
      setCaptionBoxHeight((current) => (Math.abs(current - next) < 1 ? current : next));
    },
    [captionPadding],
  );
  const [busySize, setBusySize] = useState<ShareCardSize | null>(null);
  const [batch, setBatch] = useState<ImageBatch>({
    model: null,
    images: {},
    done: false,
  });
  const rendererRef = useRef<CardRendererHandle | null>(null);

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
    // A share dialog gets the caption with its link; where there is none,
    // "Link copied" copies the link alone (the caption has its own button).
    const outcome = await shareText(ensureLinkInText(caption, url), t("share.title"), {
      clipboardText: url,
    });
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
                onContentSizeChange={onCaptionContentSizeChange}
                style={[
                  typography.bodyDefault,
                  styles.input,
                  {
                    color: colors.text.primary,
                    backgroundColor: colors.surface.base,
                    borderColor: colors.border.default,
                    padding: captionPadding,
                    height: Math.max(CAPTION_MIN_HEIGHT, captionBoxHeight),
                  },
                ]}
              />
            </View>

            <ShareActionButton
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
                <ShareActionButton
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
            <PostToProfileAction
              eventRef={profileRef}
              caption={caption}
              {...(postsTransport ? { transport: postsTransport } : {})}
              {...(guidelinesTransport ? { guidelinesTransport } : {})}
            />
            {/* Instagram and TikTok take the picture only; the caption then
             * has to be pasted, so copying it is always one tap away. */}
            <ShareActionButton
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
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: CAPTION_MIN_HEIGHT,
    textAlignVertical: "top",
  },
  statusRow: { minHeight: 22 },
});
