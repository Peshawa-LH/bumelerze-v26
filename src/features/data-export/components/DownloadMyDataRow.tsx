import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useSnackbar } from "@/components/Snackbar";
import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsRow } from "@/features/account/components/SettingsRow";
import { communityErrorText } from "@/features/community/error-text";
import { CommunityError } from "@/features/community/types";
import { useTheme } from "@/theme";
import { deliverJsonFile } from "../deliver";
import {
  SupabaseDataExportTransport,
  exportFileName,
  exportText,
  type DataExportTransport,
} from "../transport";
import type { DeliveryOutcome } from "../types";

type Deliver = (
  text: string,
  fileName: string,
  title: string,
) => Promise<DeliveryOutcome>;

/**
 * "Download my data" on the owner's Profile page (under "Only you see this"):
 * one JSON file with everything the person gave Bumelerze, their own felt
 * report places included. Web downloads it; a phone opens the share sheet.
 */
export function DownloadMyDataRow({
  transport = SupabaseDataExportTransport,
  deliver = deliverJsonFile,
}: {
  transport?: DataExportTransport;
  deliver?: Deliver;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const snackbar = useSnackbar();
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function run() {
    if (busy) {
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      const data = await transport.fetchMyData();
      const outcome = await deliver(
        exportText(data),
        exportFileName(),
        t("profile.dataExport.fileTitle"),
      );
      if (outcome === "unavailable") {
        setErrorText(t("profile.dataExport.error"));
      } else {
        snackbar.show({ message: t("profile.dataExport.done") });
      }
    } catch (error) {
      setErrorText(
        error instanceof CommunityError && error.code !== "unknown"
          ? communityErrorText(t, error)
          : t("profile.dataExport.error"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing[1] }}>
      <SettingsGroup testID="data-export-group">
        <SettingsRow
          icon="download-outline"
          label={busy ? t("profile.dataExport.working") : t("profile.dataExport.title")}
          onPress={() => void run()}
          disabled={busy}
          accessibilityHint={t("profile.dataExport.hint")}
          testID="data-export-row"
        />
      </SettingsGroup>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("profile.dataExport.hint")}
      </Text>
      {errorText ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: colors.status.danger,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
          testID="data-export-error"
        >
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}
