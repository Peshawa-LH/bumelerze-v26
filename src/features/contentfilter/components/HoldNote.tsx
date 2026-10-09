import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";

import type { ContentHold } from "../types";

/**
 * Why a comment or post waits for review, for moderators (migration 0059):
 * the word or phrase the filter matched and its kind, or "new account
 * during a busy time". Nothing when there is no recorded hold (a guest's
 * comment, or one sent to review by readers' reports).
 */
export function HoldNote({
  holds,
  testID,
}: {
  holds: readonly ContentHold[] | undefined;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  if (!holds || holds.length === 0) {
    return null;
  }
  const filter = holds.filter((hold) => hold.reason === "filter" && hold.term);
  const surge = holds.some((hold) => hold.reason === "surge");
  const lines: string[] = filter.map((hold) =>
    t("contentFilter.hold.filter", {
      term: hold.term ?? "",
      kind: t(`contentFilter.kinds.${hold.kind ?? "other"}`),
    }),
  );
  if (surge) {
    lines.push(t("contentFilter.hold.surge"));
  }
  return (
    <Text
      testID={testID}
      style={{
        color: colors.text.primary,
        fontSize: typography.bodyMeta.fontSize,
        lineHeight: typography.bodyMeta.lineHeight,
        textAlign: "auto",
      }}
    >
      {lines.join("\n")}
    </Text>
  );
}
