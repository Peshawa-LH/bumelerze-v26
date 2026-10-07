import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { communityErrorText } from "../error-text";
import { useCommunityActions, useFollowRequests } from "../queries";
import type { CommunityTransport } from "../transport";
import { LinkButton } from "./LinkButton";
import { PeopleList } from "./PeopleList";

/** Pending follow requests: Accept or Decline each. Renders nothing when
 * there are none (or the server cannot answer yet). */
export function FollowRequestsSection({ transport }: { transport?: CommunityTransport }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const requests = useFollowRequests(transport);
  const actions = useCommunityActions(transport);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!requests.data || requests.data.length === 0) {
    return null;
  }

  async function decide(userId: string, accept: boolean) {
    setBusyId(userId);
    setErrorText(null);
    try {
      await (accept ? actions.accept(userId) : actions.decline(userId));
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={{ gap: spacing[2] }} testID="follow-requests">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("community.requests.title")}
      </Text>
      <PeopleList
        people={requests.data}
        isLoading={false}
        isError={false}
        emptyText=""
        renderTrailing={(person) => (
          <View style={{ flexDirection: "row" }}>
            <LinkButton
              label={t("community.requests.accept")}
              accessibilityLabel={t("community.requests.acceptA11y", {
                name: person.displayName,
              })}
              disabled={busyId === person.userId}
              onPress={() => void decide(person.userId, true)}
              testID={`request-accept-${person.userId}`}
            />
            <LinkButton
              label={t("community.requests.decline")}
              accessibilityLabel={t("community.requests.declineA11y", {
                name: person.displayName,
              })}
              danger
              disabled={busyId === person.userId}
              onPress={() => void decide(person.userId, false)}
              testID={`request-decline-${person.userId}`}
            />
          </View>
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
