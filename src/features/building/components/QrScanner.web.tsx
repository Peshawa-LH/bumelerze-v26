import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useTheme } from "@/theme";
import { watchForQr, type BarcodeDetectorCtor } from "../qr-detect";
import type { QrScannerProps } from "./QrScanner";
import { Body, ErrorText } from "./ui";

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

/** Web: scanning needs the browser's `BarcodeDetector` (Chrome on Android) and a
 * camera. Elsewhere the scan button is hidden and typing the code stays. */
export function canScanQr(): boolean {
  return (
    detectorCtor() !== null &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/**
 * Live camera preview that reads one QR code with `BarcodeDetector`. It polls
 * a few times a second only while open and stops every camera track when it
 * closes.
 */
export function QrScanner({ onScan, onCancel }: QrScannerProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onScanRef = useRef(onScan);
  const [cameraFailed, setCameraFailed] = useState(false);
  // No BarcodeDetector at all: nothing to open (the join screen hides the
  // button in that case; this only guards a direct use).
  const failed = cameraFailed || detectorCtor() === null;

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    const Detector = detectorCtor();
    if (!Detector) {
      return undefined;
    }
    const detector = new Detector({ formats: ["qr_code"] });
    let closed = false;
    let stream: MediaStream | null = null;
    let stopWatching: (() => void) | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (opened) => {
        const video = videoRef.current;
        if (closed || !video) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        video.srcObject = opened;
        await video.play();
        stopWatching = watchForQr(video, detector, (text) => onScanRef.current(text));
      })
      .catch(() => setCameraFailed(true));

    return () => {
      closed = true;
      stopWatching?.();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <View style={{ gap: spacing[3] }} testID="scan-camera">
      {failed ? (
        <ErrorText>{t("building.join.scan.failed")}</ErrorText>
      ) : (
        <>
          <Body tone="secondary">{t("building.join.scan.hint")}</Body>
          <View style={[styles.frame, { backgroundColor: colors.surface.sunken }]}>
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label={t("building.join.scan.cameraLabel")}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </View>
        </>
      )}
      <AccountButton
        label={t("building.join.scan.cancel")}
        onPress={onCancel}
        testID="scan-cancel"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 320, borderRadius: 12, overflow: "hidden" },
});
