import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useTheme } from "@/theme";
import {
  CODE_PATTERN,
  KEY_PATTERN,
  normalizeCode,
  normalizeKey,
  parseJoinLink,
} from "../constants";
import { homeErrorText } from "../error-text";
import { useHomeActions } from "../queries";
import { AccountGate } from "./AccountGate";
import { QrScanner, canScanQr } from "./QrScanner";
import { Body, Card, ErrorText, Heading, ScreenFrame, TextField } from "./ui";

export function JoinScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    code?: string | string[];
    key?: string | string[];
  }>();
  const linkCode = paramText(params.code);
  const linkKey = paramText(params.key);
  return (
    <ScreenFrame title={t("building.join.title")}>
      <AccountGate>
        {/* A new link opened while this screen shows starts the form afresh. */}
        <JoinForm
          key={`${linkCode}|${linkKey}`}
          initialCode={linkCode}
          initialKey={linkKey}
        />
      </AccountGate>
    </ScreenFrame>
  );
}

/** The first value of a route param (a repeated param arrives as an array). */
function paramText(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Code + key of someone else's home. The request waits for the owner. The
 * fields can be filled by typing, by scanning the family's QR code, or by
 * opening the invite link (`/home/join?code=...&key=...`), which pre-fills them
 * but never sends the request: the person taps "Ask to join".
 */
export function JoinForm({
  initialCode = "",
  initialKey = "",
}: {
  initialCode?: string;
  initialKey?: string;
}) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const actions = useHomeActions();
  const [code, setCode] = useState(initialCode);
  const [key, setKey] = useState(initialKey);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  function onScanned(text: string) {
    setScanning(false);
    const parsed = parseJoinLink(text);
    if (parsed) {
      setError(null);
      setCode(parsed.code);
      setKey(parsed.key);
    } else {
      setError(t("building.join.scan.notInvite"));
    }
  }

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

  if (scanning) {
    return <QrScanner onScan={onScanned} onCancel={() => setScanning(false)} />;
  }

  return (
    <View style={{ gap: spacing[4] }}>
      <Body tone="secondary">{t("building.join.intro")}</Body>
      {canScanQr() ? (
        <AccountButton
          label={t("building.join.scan.button")}
          onPress={() => {
            setError(null);
            setScanning(true);
          }}
          testID="join-scan"
        />
      ) : null}
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
