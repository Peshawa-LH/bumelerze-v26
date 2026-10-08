import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { LinkButton } from "@/features/community/components/LinkButton";
import { PeopleList } from "@/features/community/components/PeopleList";
import type { Person } from "@/features/community/types";
import { useTheme } from "@/theme";
import { useMuteActions, useMutedPeople } from "../queries";
import type { MuteTransport } from "../transport";

/** "Muted people" on People and requests, next to Blocked: each with Unmute.
 * Hidden when there is nobody. */
export function MutedSection({ transport }: { transport?: MuteTransport }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const muted = useMutedPeople(transport);
  const actions = useMuteActions(transport);
  const [errorText, setErrorText] = useState<string | null>(null);

  if (!muted.data || muted.data.length === 0) {
    return null;
  }
  const people: Person[] = muted.data.map((person) => ({
    userId: person.userId,
    username: person.username,
    displayName: person.displayName ?? t("community.muted.guest"),
    avatarPath: person.avatarPath,
    roles: [],
  }));

  return (
    <View style={{ gap: spacing[2] }} testID="muted-people">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("community.muted.title")}
      </Text>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {t("community.muted.hint")}
      </Text>
      <PeopleList
        people={people}
        isLoading={false}
        isError={false}
        emptyText=""
        renderTrailing={(person) => (
          <LinkButton
            label={t("community.mute.unmute")}
            accessibilityLabel={t("community.muted.unmuteA11y", {
              name: person.displayName,
            })}
            onPress={() =>
              void actions
                .unmute(person.userId)
                .then(() => setErrorText(null))
                .catch((error: unknown) => setErrorText(communityErrorText(t, error)))
            }
            testID={`unmute-${person.userId}`}
          />
        )}
      />
      {errorText ? (
        <Text accessibilityRole="alert" style={{ color: colors.status.danger }}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}
