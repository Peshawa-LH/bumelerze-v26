import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import type Svg from "react-native-svg";

import type { CardModel } from "./card-layout";
import { rasterizeCard } from "./image-export";
import { ShareCardSvg } from "./ShareCardSvg";
import type { ShareCardSize, ShareImage } from "./types";

/** The card is mounted tiny and exported large: vectors scale crisply and the
 * only full-size bitmap is the 1080-wide result. */
const HOST_WIDTH = 270;

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
  const svgRef = useRef<Svg | null>(null);
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
        const image = await rasterizeCard(svgRef.current, job.size);
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
  return (
    <View
      testID="share-card-host"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // Pin the box's own direction: the card handles RTL itself.
      style={[styles.host, { direction: "ltr" }]}
    >
      <ShareCardSvg ref={svgRef} model={model} displayWidth={HOST_WIDTH} />
    </View>
  );
});

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: -4000,
    width: HOST_WIDTH,
    opacity: 0,
  },
});
