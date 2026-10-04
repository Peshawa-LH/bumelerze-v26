import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useTheme } from "@/theme";
import { CODE_PATTERN, KEY_PATTERN, normalizeCode, normalizeKey } from "../constants";
import { homeErrorText } from "../error-text";
import { useHomeActions } from "../queries";
import { AccountGate } from "./AccountGate";
import { Body, Card, ErrorText, Heading, ScreenFrame, TextField } from "./ui";

export function JoinScreen() {
  const { t } = useTranslation();
  return (
    <ScreenFrame title={t("building.join.title")}>
      <AccountGate>
        <JoinForm />
      </AccountGate>
    </ScreenFrame>
  );
}

/** Code + key of someone else's home. The request waits for the owner. */
export function JoinForm() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const actions = useHomeActions();
  const [code, setCode] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  const valid =
    CODE_PATTERN.test(normalizeCode(code)) && KEY_PATTERN.test(normalizeKey(key));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await actions.join(normalizeCode(code), normalizeKey(key));
      if (result.status === "approved") {
        router.replace({
          pathname: "/home/[tagId]/report",
          params: { tagId: result.tagId },
        });
      } else {
        setWaiting(true);
      }
    } catch (caught) {
      setError(homeErrorText(t, caught));
    } finally {
      setBusy(false);
    }
  }

  if (waiting) {
    return (
      <Card testID="join-waiting">
        <Heading level={3}>{t("building.join.waitingTitle")}</Heading>
        <Body tone="secondary">{t("building.join.waiting")}</Body>
        <AccountButton
          label={t("building.join.done")}
          onPress={() => router.replace("/my-data")}
          testID="join-done"
        />
      </Card>
    );
  }

  return (
    <View style={{ gap: spacing[4] }}>
      <Body tone="secondary">{t("building.join.intro")}</Body>
      <TextField
        label={t("building.join.codeLabel")}
        placeholder="BMH-XXXXXX"
        value={code}
        onChangeText={setCode}
        maxLength={12}
        latin
        testID="join-code"
      />
      <TextField
        label={t("building.join.keyLabel")}
        placeholder="XXXXXXXX"
        value={key}
        onChangeText={setKey}
        maxLength={12}
        latin
        testID="join-key"
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <AccountButton
        tone="primary"
        label={busy ? t("building.join.sending") : t("building.join.request")}
        onPress={() => void submit()}
        disabled={busy || !valid}
        testID="join-submit"
      />
    </View>
  );
}
