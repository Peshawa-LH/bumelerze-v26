import { ActivityIndicator, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import type { Person } from "../types";
import { PersonRow } from "./PersonRow";

/** A plain list of people with loading, error and empty states. */
export function PeopleList({
  people,
  isLoading,
  isError,
  emptyText,
  renderTrailing,
  testID,
}: {
  people: readonly Person[] | undefined;
  isLoading: boolean;
  isError: boolean;
  emptyText: string;
  renderTrailing?: (person: Person) => React.ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;

  if (isLoading) {
    return <ActivityIndicator accessibilityLabel={t("eventDetail.loading")} />;
  }
  if (isError) {
    return <Text style={meta}>{t("eventHub.loadError")}</Text>;
  }
  if (!people || people.length === 0) {
    return (
      <Text style={meta} testID={testID ? `${testID}-empty` : undefined}>
        {emptyText}
      </Text>
    );
  }
  return (
    <View style={{ gap: spacing[1] }} testID={testID}>
      {people.map((person) => (
        <PersonRow
          key={person.userId}
          person={person}
          trailing={renderTrailing?.(person)}
          testID={`person-${person.userId}`}
        />
      ))}
    </View>
  );
}
