import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { LinkQr } from "@/features/share/LinkQr";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";
import { accountErrorText } from "../error-text";
import {
  abandonTwoStepSetup,
  confirmTwoStepSetup,
  isCompleteTwoStepCode,
  startTwoStepSetup,
  turnOffTwoStep,
} from "../two-step";
import { AccountError } from "../types";
import { AccountButton } from "./AccountButton";
import { AuthErrorText } from "./AuthErrorText";
import { CodeField } from "./CodeField";
import { LostPhoneNote } from "./LostPhoneNote";

const COPIED_MS = 2000;

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; text: string }
  | { kind: "setup"; factorId: string; secret: string; uri: string }
  | { kind: "turnedOn" }
  | { kind: "on" }
  | { kind: "turnedOff" };

/** The key in groups of four, easier to type into an authenticator by hand
 * (the apps ignore the spaces; Copy key copies it without them). */
export function groupKey(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * Two-step sign-in, set up or turned off (My account > Two-step sign-in).
 * Off: a new authenticator key is made at once (any unverified one left
 * from an abandoned attempt is removed first) and shown as a QR code and as
 * text; the first code from it turns two-step sign-in on. On: "Turn off"
 * asks for a code, then removes it. Leaving before the code removes the
 * unverified key again.
 */
export function TwoStepSetupContent({
  onDone,
  onContactUs,
  onChanged,
}: {
  onDone: () => void;
  onContactUs: () => void;
  /** Two-step sign-in was turned on or off (refresh what shows it). */
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The unverified factor this screen made, until a code verifies it.
  const pendingFactor = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    startTwoStepSetup()
      .then((result) => {
        if (result.kind === "alreadyOn") {
          if (active) setPhase({ kind: "on" });
          return;
        }
        if (!active) {
          void abandonTwoStepSetup(result.factorId);
          return;
        }
        pendingFactor.current = result.factorId;
        setPhase(result);
      })
      .catch((error: unknown) => {
        if (active) setPhase({ kind: "failed", text: accountErrorText(t, error) });
      });
    return () => {
      active = false;
    };
    // `t` is stable for the screen's life; a language change reloads the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Leaving before a code verified the new key: remove it (best effort).
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      if (pendingFactor.current) {
        void abandonTwoStepSetup(pendingFactor.current);
        pendingFactor.current = null;
      }
    },
    [],
  );

  const body = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    fontFamily: nativeFontFamily(typography.bodyDefault),
    ...READING_START,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;
  const strong = { ...body, color: colors.text.primary } as const;

  async function copyKey(secret: string) {
    try {
      await Clipboard.setStringAsync(secret);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Clipboard unavailable: the key is still selectable text.
    }
  }

  async function run(action: () => Promise<void>) {
    if (!isCompleteTwoStepCode(code) || busy) {
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      await action();
    } catch (error) {
      setErrorText(accountErrorText(t, error));
      if (error instanceof AccountError && error.code === "wrong_code") {
        setCode("");
      }
    } finally {
      setBusy(false);
    }
  }

  function turnOn(factorId: string) {
    void run(async () => {
      await confirmTwoStepSetup(factorId, code);
      pendingFactor.current = null;
      setCode("");
      setPhase({ kind: "turnedOn" });
      onChanged();
    });
  }

  function turnOff() {
    void run(async () => {
      await turnOffTwoStep(code);
      setCode("");
      setTurningOff(false);
      setPhase({ kind: "turnedOff" });
      onChanged();
    });
  }

  if (phase.kind === "loading") {
    return (
      <Text style={body} testID="two-step-loading">
        {t("nav.loading")}
      </Text>
    );
  }

  if (phase.kind === "failed") {
    return (
      <View style={{ gap: spacing[3] }}>
        <AuthErrorText text={phase.text} testID="two-step-load-error" />
        <AccountButton
          tone="primary"
          label={t("nav.retry")}
          onPress={() => {
            setPhase({ kind: "loading" });
            setAttempt((n) => n + 1);
          }}
          testID="two-step-retry"
        />
      </View>
    );
  }

  if (phase.kind === "turnedOn" || phase.kind === "turnedOff") {
    return (
      <View style={{ gap: spacing[4] }}>
        <View style={[styles.statusRow, { gap: spacing[2] }]}>
          <Ionicons
            name={phase.kind === "turnedOn" ? "lock-closed-outline" : "lock-open-outline"}
            size={24}
            color={phase.kind === "turnedOn" ? colors.status.success : colors.text.secondary}
          />
          <Text
            accessibilityLiveRegion="polite"
            testID={phase.kind === "turnedOn" ? "two-step-turned-on" : "two-step-turned-off"}
            style={[strong, styles.flex]}
          >
            {phase.kind === "turnedOn"
              ? t("account.twoStep.turnedOn")
              : t("account.twoStep.isOff")}
          </Text>
        </View>
        <AccountButton
          tone="primary"
          label={t("account.signIn.done")}
          onPress={onDone}
          testID="two-step-done"
        />
      </View>
    );
  }

  if (phase.kind === "on") {
    return (
      <View style={{ gap: spacing[4] }}>
        <View style={[styles.statusRow, { gap: spacing[2] }]}>
          <Ionicons name="lock-closed-outline" size={24} color={colors.status.success} />
          <Text style={[strong, styles.flex]} testID="two-step-is-on">
            {t("account.twoStep.isOn")}
          </Text>
        </View>
        {turningOff ? (
          <View style={{ gap: spacing[3] }}>
            <Text style={body}>{t("account.twoStep.turnOffPrompt")}</Text>
            <CodeField
              label={t("account.twoStep.codeLabel")}
              value={code}
              onChangeText={setCode}
              onSubmitEditing={turnOff}
              testID="two-step-off-code-input"
            />
            <AccountButton
              tone="destructiveSolid"
              label={t("account.twoStep.turnOff")}
              disabled={!isCompleteTwoStepCode(code) || busy}
              onPress={turnOff}
              testID="two-step-off-confirm"
            />
            <AuthErrorText text={errorText} testID="two-step-error" />
          </View>
        ) : (
          <AccountButton
            tone="destructive"
            label={t("account.twoStep.turnOff")}
            onPress={() => setTurningOff(true)}
            testID="two-step-turn-off"
          />
        )}
        <LostPhoneNote onContactUs={onContactUs} />
      </View>
    );
  }

  // Off: the new key, then the first code.
  const { factorId, secret, uri } = phase;
  return (
    <View style={{ gap: spacing[4] }} testID="two-step-setup">
      <Text style={body}>{t("account.twoStep.intro")}</Text>
      <Text style={strong}>{t("account.twoStep.step1")}</Text>
      <LinkQr value={uri} label={t("account.twoStep.qrLabel")} testID="two-step-qr" />
      <View style={{ gap: spacing[2] }}>
        <Text style={body}>{t("account.twoStep.cantScan")}</Text>
        <Text
          selectable
          testID="two-step-key"
          style={[styles.key, { color: colors.text.primary }]}
        >
          {groupKey(secret)}
        </Text>
        <AccountButton
          label={t("account.twoStep.copyKey")}
          onPress={() => void copyKey(secret)}
          testID="two-step-copy-key"
        />
        {copied ? (
          <Text
            accessibilityLiveRegion="polite"
            testID="two-step-key-copied"
            style={[
              typography.bodyMeta,
              styles.centered,
              { color: colors.status.success },
            ]}
          >
            {t("myData.privacy.copied")}
          </Text>
        ) : null}
      </View>
      <Text style={strong}>{t("account.twoStep.step2")}</Text>
      <CodeField
        label={t("account.twoStep.codeLabel")}
        value={code}
        onChangeText={setCode}
        onSubmitEditing={() => turnOn(factorId)}
        testID="two-step-setup-code-input"
      />
      <AccountButton
        tone="primary"
        label={t("account.twoStep.turnOn")}
        disabled={!isCompleteTwoStepCode(code) || busy}
        onPress={() => turnOn(factorId)}
        testID="two-step-turn-on"
      />
      <AuthErrorText text={errorText} testID="two-step-error" />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  statusRow: { flexDirection: "row", alignItems: "center" },
  centered: { textAlign: "center" },
  key: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 28,
    textAlign: "center",
    writingDirection: "ltr",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
});
