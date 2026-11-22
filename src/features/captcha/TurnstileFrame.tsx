import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import {
  buildTurnstilePageUrl,
  isAllowedTurnstileNavigation,
  parseTurnstileBridgeMessage,
} from "./bridge";
import {
  TURNSTILE_FRAME_HEIGHT,
  TURNSTILE_FRAME_WIDTH,
  type TurnstileFrameProps,
} from "./frame-types";

/**
 * iOS/Android: Turnstile runs only on a web page of a hostname the widget
 * allows, so the app opens `https://app.bumelerze.com/turnstile`
 * (`public/turnstile.html`, shipped with the web build) in a WebView, the
 * pattern Cloudflare documents for mobile apps. The page draws the widget and
 * posts the outcome back as JSON (`./bridge.ts`). Only messages from that
 * page are read, and the WebView never leaves it. One WebView = one token:
 * the host mounts a fresh one per request. The web build uses
 * `TurnstileFrame.web.tsx` and never bundles react-native-webview.
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
  const settledRef = useRef(false);
  const finish = (outcome: () => void) => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    outcome();
  };

  const uri = buildTurnstilePageUrl({
    siteKey,
    language,
    theme,
    appearance: visible ? "always" : "interaction-only",
  });
  useEffect(() => {
    // Not reachable with a key from config.ts (same check): fail, never crash.
    if (uri === null && !settledRef.current) {
      settledRef.current = true;
      onFailure();
    }
  }, [uri, onFailure]);

  function handleMessage(event: WebViewMessageEvent) {
    const message = parseTurnstileBridgeMessage(
      event.nativeEvent.data,
      event.nativeEvent.url,
    );
    if (!message) {
      return;
    }
    if (message.type === "token") {
      finish(() => onToken(message.token));
    } else if (message.type === "interactive") {
      if (!visible && !settledRef.current) {
        onInteractive();
      }
    } else {
      finish(onFailure);
    }
  }

  if (uri === null) {
    return null;
  }

  return (
    <WebView
      testID="turnstile-webview"
      accessibilityLabel={accessibilityLabel}
      source={{ uri }}
      originWhitelist={["https://*"]}
      onShouldStartLoadWithRequest={(request) =>
        isAllowedTurnstileNavigation(request.url, request.isTopFrame)
      }
      onMessage={handleMessage}
      onError={() => finish(onFailure)}
      onHttpError={() => finish(onFailure)}
      onContentProcessDidTerminate={() => finish(onFailure)}
      onRenderProcessGone={() => finish(onFailure)}
      setSupportMultipleWindows={false}
      javaScriptEnabled
      scrollEnabled={false}
      style={visible ? styles.visible : styles.hidden}
    />
  );
}

const styles = StyleSheet.create({
  visible: {
    width: "100%",
    minWidth: TURNSTILE_FRAME_WIDTH,
    height: TURNSTILE_FRAME_HEIGHT,
    backgroundColor: "transparent",
  },
  hidden: {
    width: TURNSTILE_FRAME_WIDTH,
    height: TURNSTILE_FRAME_HEIGHT,
    backgroundColor: "transparent",
  },
});
