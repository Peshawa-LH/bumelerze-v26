import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { neutral } from "@/theme/palette";

/**
 * A link as a QR code. A scanner needs dark modules on a light ground
 * whatever the app theme, so the colours are fixed (not themed) and the code
 * sits on a white card with its quiet zone. Error correction M: the links are
 * short, and M survives a screenshot recompressed by a messenger. Used by the
 * family invite and the profile share sheet.
 */
export function LinkQr({
  value,
  label,
  size = 200,
  testID,
}: {
  value: string;
  /** What a screen reader says for the image. */
  label: string;
  size?: number;
  testID?: string;
}) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID={testID}
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
