import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useTranslation } from "react-i18next";

import { neutral } from "@/theme/palette";

/**
 * The family invite as a QR code. A scanner needs dark modules on a light
 * ground whatever the app theme, so the colours are fixed (not themed) and the
 * code sits on a white card with its quiet zone. The text it carries is the
 * join link: code and key only, never the location.
 */
export function JoinQr({ value, size = 200 }: { value: string; size?: number }) {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("building.family.qrLabel")}
      testID="family-qr"
      style={{
        alignSelf: "center",
        padding: 12,
        borderRadius: 12,
        backgroundColor: neutral[0],
      }}
    >
      <QRCode
        value={value}
        size={size}
        color={neutral[1100]}
        backgroundColor={neutral[0]}
        ecl="M"
      />
    </View>
  );
}
