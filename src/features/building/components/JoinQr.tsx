import { useTranslation } from "react-i18next";

import { LinkQr } from "@/features/share/LinkQr";

/**
 * The family invite as a QR code (the shared `LinkQr`). The text it carries
 * is the join link: code and key only, never the location.
 */
export function JoinQr({ value, size = 200 }: { value: string; size?: number }) {
  const { t } = useTranslation();
  return (
    <LinkQr
      value={value}
      size={size}
      label={t("building.family.qrLabel")}
      testID="family-qr"
    />
  );
}
