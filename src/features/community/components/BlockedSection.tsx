import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { communityErrorText } from "../error-text";
import { useBlockedPeople, useCommunityActions } from "../queries";
import type { CommunityTransport } from "../transport";
import { LinkButton } from "./LinkButton";
import { PeopleList } from "./PeopleList";

/** Accounts the viewer blocked, each with Unblock. Hidden when empty. */
export function BlockedSection({ transport }: { transport?: CommunityTransport }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const blocked = useBlockedPeople(transport);
  const actions = useCommunityActions(transport);
  const [errorText, setErrorText] = useState<string | null>(null);

  if (!blocked.data || blocked.data.length === 0) {
    return null;
  }

  return (
    <View style={{ gap: spacing[2] }} testID="blocked-people">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("community.blocked.title")}
      </Text>
      <PeopleList
        people={blocked.data}
        isLoading={false}
        isError={false}
        emptyText=""
        renderTrailing={(person) => (
          <LinkButton
            label={t("community.block.unblock")}
            accessibilityLabel={t("community.blocked.unblockA11y", {
              name: person.displayName,
            })}
            onPress={() =>
              void actions
                .unblock(person.userId)
                .then(() => setErrorText(null))
                .catch((error: unknown) => setErrorText(communityErrorText(t, error)))
            }
            testID={`unblock-${person.userId}`}
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
