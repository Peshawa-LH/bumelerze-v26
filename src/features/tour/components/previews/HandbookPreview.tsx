import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { useTheme, nativeFontFamily, READING_START } from "@/theme";

/** Three of the handbook's result rows; their values are drawn, not real. */
const SAMPLE_ROWS = ["isc2025", "pga", "siteClass"] as const;

/** Engineer's handbook: its title and the shape of its result table. */
export function HandbookPreview() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
        <Ionicons name="construct-outline" size={22} color={colors.brand.primary} />
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.h3.fontSize,
            fontFamily: nativeFontFamily(typography.h3, "700"),
            ...READING_START,
            fontWeight: "700",
          }}
        >
          {t("handbook.title")}
        </Text>
      </View>
      <View
        style={{
          borderWidth: 1,
          borderRadius: 14,
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
        }}
      >
        {SAMPLE_ROWS.map((row, index) => (
          <View
            key={row}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing[3],
              padding: spacing[3],
              borderTopWidth: index === 0 ? 0 : 1,
              borderColor: colors.border.subtle,
            }}
          >
            <Text
              style={{
                flex: 1,
                color: colors.text.secondary,
                fontSize: typography.bodyMeta.fontSize,
                fontFamily: nativeFontFamily(typography.bodyMeta),
                ...READING_START,
              }}
            >
              {t(`handbook.rows.${row}.label`)}
            </Text>
            <View
              style={{
                width: 72,
                height: 10,
                borderRadius: 5,
                backgroundColor: colors.border.default,
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}
