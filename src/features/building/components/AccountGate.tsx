import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useAccount } from "@/features/account/use-account";
import { Body, Card } from "./ui";

/**
 * Tag my building is for accounts only. Anonymous installs see a card that
 * leads to the account sign-in; accounts see the children.
 */
export function AccountGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const account = useAccount();

  if (account.status === "account") {
    return <>{children}</>;
  }
  if (account.status === "loading") {
    return <Body tone="secondary">{t("building.loading")}</Body>;
  }
  if (account.status === "unconfigured") {
    return <Body tone="secondary">{t("account.errors.unconfigured")}</Body>;
  }
  return (
    <Card testID="home-gate">
      <Body>{t("building.gate.title")}</Body>
      <AccountButton
        tone="primary"
        label={t("building.gate.cta")}
        onPress={() => router.push("/account/sign-in")}
        testID="home-gate-sign-in"
      />
    </Card>
  );
}
