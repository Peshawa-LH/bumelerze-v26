import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { Sheet } from "@/features/admin/people/components/Sheet";
import { SHARE_PROFILE_URL_BASE } from "@/features/share/config";
import { LinkQr } from "@/features/share/LinkQr";
import { copyText, shareText } from "@/features/share/share-text";
import { useTheme } from "@/theme";
import { formatUsername } from "../username";

/** The public link of a profile: the web app's `/u/<username>` page. */
export function profileShareUrl(username: string): string {
  return `${SHARE_PROFILE_URL_BASE}/${encodeURIComponent(username)}`;
}

/**
 * "Share profile": the profile link as a QR code (to show on the phone, so a
 * relative or a colleague can scan it), the link itself, and Share / Copy.
 * The QR carries only the public link, nothing else.
 */
export function ProfileShareSheet({
  username,
  displayName,
  onClose,
  testID = "profile-share-sheet",
}: {
  username: string;
  displayName: string;
  onClose: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [notice, setNotice] = useState<string | null>(null);
  const url = profileShareUrl(username);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  async function share() {
    const outcome = await shareText(url, displayName);
    if (outcome === "copied") {
      setNotice(t("share.linkCopied"));
    } else if (outcome === "failed") {
      setNotice(t("community.profile.shareFailed"));
    } else {
      setNotice(null);
    }
  }

  async function copy() {
    setNotice(
      (await copyText(url)) ? t("share.linkCopied") : t("community.profile.shareFailed"),
    );
  }

  return (
    <Sheet
      title={t("community.profile.share")}
      subtitle={formatUsername(username)}
      onClose={onClose}
      testID={testID}
    >
      <LinkQr
        value={url}
        label={t("community.profile.qrLabel", { name: displayName })}
        testID={`${testID}-qr`}
      />
      <Text style={[meta, { textAlign: "center" }]}>{t("community.profile.qrHint")}</Text>
      <Text
        selectable
        testID={`${testID}-url`}
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyMeta.fontSize,
          // a link always reads left to right, also inside Sorani/Arabic
          writingDirection: "ltr",
          textAlign: "center",
        }}
      >
        {url}
      </Text>
      <View style={{ gap: spacing[2] }}>
        <AccountButton
          tone="primary"
          label={t("community.profile.shareLink")}
          onPress={() => void share()}
          testID={`${testID}-share`}
        />
        <AccountButton
          label={t("community.profile.copyLink")}
          onPress={() => void copy()}
          testID={`${testID}-copy`}
        />
      </View>
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={meta} testID={`${testID}-notice`}>
          {notice}
        </Text>
      ) : null}
    </Sheet>
  );
}
