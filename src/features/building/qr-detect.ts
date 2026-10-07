/** The part of the browser's shape-detection API used for scanning. */
export interface BarcodeDetectorLike {
  detect(source: unknown): Promise<{ rawValue: string }[]>;
}
export type BarcodeDetectorCtor = new (options: {
  formats: string[];
}) => BarcodeDetectorLike;

/** Time between two looks at the camera picture (a few per second, not per frame). */
export const SCAN_INTERVAL_MS = 250;

/**
 * Looks at `video` every `SCAN_INTERVAL_MS` until a QR code is found, then
 * reports its text once and stops. Frames that cannot be read yet are skipped.
 * Returns a function that stops the watching early.
 */
export function watchForQr(
  video: unknown,
  detector: BarcodeDetectorLike,
  onCode: (text: string) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick() {
    if (stopped) {
      return;
    }
    try {
      const found = (await detector.detect(video))[0]?.rawValue;
      if (found && !stopped) {
        stopped = true;
        onCode(found);
        return;
      }
    } catch {
      // A frame that cannot be read yet; try again on the next tick.
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
    }
  }

  void tick();
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
