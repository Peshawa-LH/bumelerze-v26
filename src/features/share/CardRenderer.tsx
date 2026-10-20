import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { PixelRatio, Platform, StyleSheet, View } from "react-native";

import type { CardModel } from "./card-layout";
import { SHARE_IMAGE_WIDTH } from "./config";
import { rasterizeCard } from "./image-export";
import { ShareCardSvg, type ShareCardRef } from "./ShareCardSvg";
import type { ShareCardSize, ShareImage } from "./types";

/** Web: the card is mounted tiny and exported large (the exporter draws the
 * SVG at 1080 wide), so the only full-size bitmap is the result. */
const WEB_HOST_WIDTH = 270;

/** Phone: the export is a capture of the mounted view at the screen's own
 * pixel density, so the card is mounted at the size that captures as exactly
 * 1080 pixels wide (360 points on a 3x iPhone). */
export function shareCardHostWidth(): number {
  return Platform.OS === "web" ? WEB_HOST_WIDTH : SHARE_IMAGE_WIDTH / PixelRatio.get();
}

export interface CardRendererHandle {
  /** Mounts the card for `size`, rasterises it, unmounts it. Calls queue. */
  render(size: ShareCardSize): Promise<ShareImage>;
}

interface Job {
  size: ShareCardSize;
  resolve: (image: ShareImage) => void;
  reject: (error: unknown) => void;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}

/**
 * Generates share images on demand. Renders nothing until `render()` is
 * called; then it mounts the card hidden (transparent, off to the side, out of
 * the accessibility tree), waits for it to lay out, rasterises it through the
 * platform exporter and unmounts it again. Images are made only when asked
 * for, one at a time, so a low-end phone never holds two cards in memory.
 */
export const CardRenderer = forwardRef<
  CardRendererHandle,
  { buildModel: (size: ShareCardSize) => CardModel }
>(function CardRenderer({ buildModel }, ref) {
  const [job, setJob] = useState<Job | null>(null);
  const cardRef = useRef<ShareCardRef | null>(null);
  const jobRef = useRef<Job | null>(null);
  jobRef.current = job;
  const tail = useRef<Promise<unknown>>(Promise.resolve());

  useImperativeHandle(
    ref,
    () => ({
      render(size) {
        const run = () =>
          new Promise<ShareImage>((resolve, reject) => {
            setJob({ size, resolve, reject });
          });
        const next = tail.current.then(run, run);
        tail.current = next.catch(() => undefined);
        return next;
      },
    }),
    [],
  );

  useEffect(() => {
    if (!job) {
      return;
    }
    let active = true;
    (async () => {
      try {
        // Two frames: the card is committed and laid out before it is read.
        await nextFrame();
        await nextFrame();
        const image = await rasterizeCard(cardRef.current, job.size);
        job.resolve(image);
      } catch (error) {
        job.reject(error);
      } finally {
        if (active) {
          setJob(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [job]);

  // Unmounted mid-job (the sheet closed): settle the pending promise.
  useEffect(
    () => () => {
      jobRef.current?.reject(new Error("share card renderer unmounted"));
    },
    [],
  );

  const model = useMemo(() => (job ? buildModel(job.size) : null), [job, buildModel]);
  if (!model) {
    return null;
  }
  const width = shareCardHostWidth();
  return (
    <View
      testID="share-card-host"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // Pin the box's own direction: the card handles RTL itself.
      style={[styles.host, { direction: "ltr", width }]}
    >
      <ShareCardSvg ref={cardRef} model={model} displayWidth={width} />
    </View>
  );
});

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: -4000,
    opacity: 0,
  },
});
