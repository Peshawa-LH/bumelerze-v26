import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

/** The note a reporter wrote, quoted, for the admin queues. Renders nothing
 * when there is none. It follows the language of the note, not of the app. */
export function ReportNote({ note, testID }: { note: string | null; testID?: string }) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  if (!note) {
    return null;
  }
  return (
    <Text
      testID={testID}
      accessibilityLabel={t("report.noteA11y", { note })}
      style={{
        color: colors.text.primary,
        fontSize: typography.bodyMeta.fontSize,
        lineHeight: typography.bodyMeta.lineHeight,
        fontStyle: "italic",
        textAlign: "auto",
      }}
    >
      {`“${note}”`}
    </Text>
  );
}
