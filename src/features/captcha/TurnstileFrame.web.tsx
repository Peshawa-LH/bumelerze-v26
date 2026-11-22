import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";

import {
  TURNSTILE_FRAME_HEIGHT,
  TURNSTILE_FRAME_WIDTH,
  type TurnstileFrameProps,
} from "./frame-types";
import { loadTurnstileScript } from "./turnstile-script.web";
import { mountTurnstileWidget } from "./turnstile-widget";

/**
 * Web: the Turnstile widget drawn straight into this page (app.bumelerze.com
 * is the hostname the widget allows). The script is loaded the first time
 * a frame mounts — that is, the first time a sign-in needs a token.
 * iOS/Android: `TurnstileFrame.tsx`.
 */
export function TurnstileFrame({
  siteKey,
  visible,
  language,
  theme,
  accessibilityLabel,
  onToken,
  onFailure,
  onInteractive,
}: TurnstileFrameProps) {
  const containerRef = useRef<View | null>(null);
  const handlersRef = useRef({ onToken, onFailure, onInteractive });
  useEffect(() => {
    handlersRef.current = { onToken, onFailure, onInteractive };
  }, [onToken, onFailure, onInteractive]);

  useEffect(() => {
    let cancelled = false;
    let unmount: (() => void) | null = null;
    loadTurnstileScript().then(
      (api) => {
        if (cancelled) {
          return;
        }
        // react-native-web: a View's ref is its <div>.
        unmount = mountTurnstileWidget(
          api,
          containerRef.current,
          {
            siteKey,
            language,
            theme,
            appearance: visible ? "always" : "interaction-only",
          },
          {
            onToken: (token) => handlersRef.current.onToken(token),
            onFailure: () => handlersRef.current.onFailure(),
            onInteractive: () => handlersRef.current.onInteractive(),
          },
        );
      },
      () => {
        if (!cancelled) {
          handlersRef.current.onFailure();
        }
      },
    );
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [siteKey, language, theme, visible]);

  return (
    <View
      ref={containerRef}
      testID="turnstile-frame"
      accessibilityLabel={accessibilityLabel}
      style={visible ? styles.visible : styles.hidden}
    />
  );
}

const styles = StyleSheet.create({
  visible: { minHeight: TURNSTILE_FRAME_HEIGHT, width: "100%", alignItems: "center" },
  hidden: { width: TURNSTILE_FRAME_WIDTH, height: TURNSTILE_FRAME_HEIGHT },
});
