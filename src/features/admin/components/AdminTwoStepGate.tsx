import { useRouter } from "expo-router";
import type { ComponentType, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useAdminTwoStepState } from "@/features/account/use-two-step";
import { directionProps } from "@/i18n";
import { useTheme } from "@/theme";
import { ToolPage } from "../ui";

/**
 * "Two-step sign-in needed" (security checklist A1.1, migration 0076): the
 * one card an admin page shows instead of its tools while this session has
 * no two-step code. Two-step sign-in off on the account: turn it on (about
 * two minutes); on: enter the code. Big type, one full-width button.
 */
export function AdminTwoStepCard({ variant }: { variant: "turnOn" | "enterCode" }) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const dir = directionProps(i18n.language);
  const turnOn = variant === "turnOn";
  return (
    <ToolPage testID="admin-two-step">
      <View
        testID="admin-two-step-card"
        style={[
          styles.card,
          {
            backgroundColor: colors.surface.raised,
            borderColor: colors.border.default,
            padding: spacing[4],
            gap: spacing[3],
          },
        ]}
      >
        <Text
          {...dir}
          accessibilityRole="header"
          style={[typography.h3, { color: colors.text.primary }]}
        >
          {t("account.twoStep.adminNeeded.title")}
        </Text>
        <Text
          {...dir}
          testID="admin-two-step-body"
          style={[typography.bodyDefault, { color: colors.text.secondary }]}
        >
          {turnOn
            ? t("account.twoStep.adminNeeded.bodyOff")
            : t("account.twoStep.challenge.body")}
        </Text>
        <AccountButton
          tone="primary"
          label={
            turnOn
              ? t("account.twoStep.adminNeeded.turnOn")
              : t("account.twoStep.adminNeeded.enterCode")
          }
          onPress={() =>
            router.push(turnOn ? "/account/two-step" : "/account/two-step-code")
          }
          testID={turnOn ? "admin-two-step-turn-on" : "admin-two-step-enter-code"}
        />
      </View>
    </ToolPage>
  );
}

/** Shows `children` (the page's tools) unless the admin tools wait for
 * two-step sign-in; then the card. While the server is asked: "Loading". */
export function AdminTwoStepGate({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const state = useAdminTwoStepState();
  if (state === "open") {
    return <>{children}</>;
  }
  if (state === "loading") {
    return (
      <ToolPage testID="admin-two-step-loading">
        <Text
          {...directionProps(i18n.language)}
          style={[typography.bodyDefault, { color: colors.text.secondary }]}
        >
          {t("nav.loading")}
        </Text>
      </ToolPage>
    );
  }
  return <AdminTwoStepCard variant={state} />;
}

/** Every screen under `app/admin/` gets its content through this (see
 * `area.ts`), so an admin page opened directly (a link, a push) shows the
 * card too, not an empty "not allowed" page. */
export function withAdminTwoStepGate<P extends object>(
  Content: ComponentType<P>,
): ComponentType<P> {
  function Gated(props: P) {
    return (
      <AdminTwoStepGate>
        <Content {...props} />
      </AdminTwoStepGate>
    );
  }
  Gated.displayName = `AdminTwoStepGate(${Content.displayName ?? Content.name})`;
  return Gated;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14 },
});
