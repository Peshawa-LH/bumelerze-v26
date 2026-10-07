import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { LEVEL_ARTWORK, LevelTile, type CartoonLevel } from "@/features/felt";
import { useTheme } from "@/theme";

import { StaticPill } from "../StaticPill";

/** A mild, a clear and a strong level, so the row reads as a scale. */
const SAMPLE_LEVELS: readonly CartoonLevel[] = [2, 4, 7];
const FELT_PILL_WIDTH = 128;

const noop = () => undefined;

/** I felt it!: the red pill and three of the real felt-level tiles. */
export function FeltPreview() {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing[4] }}>
      <StaticPill label={t("felt.pill.label")} tone="felt" minWidth={FELT_PILL_WIDTH} />
      <View style={{ flexDirection: "row", justifyContent: "center", gap: spacing[2] }}>
        {SAMPLE_LEVELS.map((level) => (
          <LevelTile
            key={level}
            level={level}
            locale={i18n.language}
            label={t(`felt.tier1.levels.${level}.label`)}
            onPress={noop}
            imageSource={LEVEL_ARTWORK[level]}
          />
        ))}
      </View>
    </View>
  );
}
