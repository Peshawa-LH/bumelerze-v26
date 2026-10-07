import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useTheme } from "@/theme";
import { Body } from "./ui";

export interface QrScannerProps {
  /** Called once with the text of the first QR code seen. */
  onScan: (text: string) => void;
  onCancel: () => void;
}

/** Native: the camera is always there. (Web checks for `BarcodeDetector`.) */
export function canScanQr(): boolean {
  return true;
}

/**
 * Live camera view that reads one QR code. The camera runs only while this
 * screen part is mounted, and asks for permission the first time (the wording
 * is in app.config.ts, shared with the photo picker).
 */
export function QrScanner({ onScan, onCancel }: QrScannerProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  if (!permission) {
    return <Body tone="secondary">{t("building.loading")}</Body>;
  }
  if (!permission.granted) {
    return (
      <View style={{ gap: spacing[3] }} testID="scan-permission">
        <Body>{t("building.join.scan.permission")}</Body>
        <AccountButton
          tone="primary"
          label={t("building.join.scan.allow")}
          onPress={() => void requestPermission()}
          testID="scan-allow"
        />
        <AccountButton
          label={t("building.join.scan.cancel")}
          onPress={onCancel}
          testID="scan-cancel"
        />
      </View>
    );
  }
  return (
    <View style={{ gap: spacing[3] }} testID="scan-camera">
      <Body tone="secondary">{t("building.join.scan.hint")}</Body>
      <View style={[styles.frame, { backgroundColor: colors.surface.sunken }]}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            if (!handled.current) {
              handled.current = true;
              onScan(data);
            }
          }}
          accessibilityLabel={t("building.join.scan.cameraLabel")}
        />
      </View>
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
