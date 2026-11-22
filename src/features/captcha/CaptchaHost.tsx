import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { Sheet } from "@/features/admin/people/components/Sheet";
import { nativeFontFamily, READING_START, useTheme } from "@/theme";

import { turnstileLanguageFor } from "./config";
import { TURNSTILE_FRAME_HEIGHT, TURNSTILE_FRAME_WIDTH } from "./frame-types";
import {
  failCaptchaRequest,
  resolveCaptchaRequest,
  showCaptchaRequest,
  useCaptchaStore,
} from "./token-broker";
import { TurnstileFrame } from "./TurnstileFrame";

/**
 * Draws the Turnstile check for the auth call that is waiting for a token
 * (`token-broker.ts`). Mounted once, in app/_layout.tsx; renders nothing at
 * all while no sign-in is waiting — which is almost always (a session, once
 * made, is kept on the device).
 *
 * Invisible by default: the widget sits in a transparent, untouchable,
 * screen-reader-hidden box. Only if Turnstile asks for a tap (rare; never
 * with an "Invisible" widget) does the check move into the app's usual
 * bottom sheet — "Quick check", one line of text, the box, and "Not now",
 * which lets the sign-in go ahead without a token (it then waits in the
 * queue like any failed sign-in). The frame is mounted afresh there (a new
 * key), so the sheet also works above iOS full-screen screens such as the
 * felt report.
 */
export function CaptchaHost() {
  const active = useCaptchaStore((state) => state.active);
  const { t, i18n } = useTranslation();
  const { scheme, colors, typography } = useTheme();
  const activeId = active?.id ?? null;

  const handleToken = useCallback(
    (token: string) => {
      if (activeId !== null) {
        resolveCaptchaRequest(activeId, token);
      }
    },
    [activeId],
  );
  const handleFailure = useCallback(() => {
    if (activeId !== null) {
      failCaptchaRequest(activeId);
    }
  }, [activeId]);
  const handleInteractive = useCallback(() => {
    if (activeId !== null) {
      showCaptchaRequest(activeId);
    }
  }, [activeId]);

  if (!active) {
    return null;
  }

  const frameProps = {
    siteKey: active.siteKey,
    language: turnstileLanguageFor(i18n.language),
    theme: scheme,
    accessibilityLabel: t("captcha.title"),
    onToken: handleToken,
    onFailure: handleFailure,
    onInteractive: handleInteractive,
  } as const;

  if (active.mode === "hidden") {
    return (
      <View
        testID="captcha-hidden"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.hiddenLayer}
      >
        <TurnstileFrame key={`hidden-${active.id}`} visible={false} {...frameProps} />
      </View>
    );
  }

  return (
    <Sheet title={t("captcha.title")} onClose={handleFailure} testID="captcha-sheet">
      <Text
        testID="captcha-body"
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          fontFamily: nativeFontFamily(typography.bodyDefault),
          ...READING_START,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("captcha.body")}
      </Text>
      <View style={styles.frameBox}>
        <TurnstileFrame key={`visible-${active.id}`} visible {...frameProps} />
      </View>
      <AccountButton
        label={t("captcha.notNow")}
        onPress={handleFailure}
        testID="captcha-not-now"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hiddenLayer: {
    position: "absolute",
    bottom: 0,
    start: 0,
    width: TURNSTILE_FRAME_WIDTH,
    height: TURNSTILE_FRAME_HEIGHT,
    opacity: 0,
    overflow: "hidden",
  },
  frameBox: {
    minHeight: TURNSTILE_FRAME_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
});
