import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { TURNSTILE_TEST_SITE_KEYS } from "../test-keys";

import i18n from "@/i18n";

import { CaptchaHost } from "../CaptchaHost";

import { __resetCaptchaForTests, getCaptchaToken } from "../token-broker";

/**
 * The host (A1.4) on iOS/Android, with the WebView replaced by a plain View
 * (jest.setup.js): nothing while no sign-in waits; an invisible,
 * untouchable, screen-reader-hidden check while one does; the "Quick check"
 * sheet only when Turnstile asks for a tap, with "Not now".
 */

const ORIGINAL_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
const KEY = TURNSTILE_TEST_SITE_KEYS.passInvisible;

/** The invisible check is hidden from screen readers on purpose, so the
 * queries must look at hidden elements too. */
const ALL = { includeHiddenElements: true } as const;

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderHost() {
  return await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <CaptchaHost />
    </SafeAreaProvider>,
  );
}

async function pageMessage(data: unknown) {
  const webview = screen.getByTestId("turnstile-webview", ALL);
  await act(async () => {
    webview.props.onMessage({
      nativeEvent: { data: JSON.stringify(data), url: webview.props.source.uri },
    });
  });
}

/** A sign-in asks for a token (as `signInAnonymously` would). Wrapped in
 * an object: an async function returning the bare promise would wait for
 * the token itself. */
async function askForToken(): Promise<{ pending: Promise<string | null> }> {
  let pending!: Promise<string | null>;
  await act(async () => {
    pending = getCaptchaToken();
  });
  return { pending };
}

beforeEach(async () => {
  __resetCaptchaForTests();
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = KEY;
  if (i18n.language !== "en") {
    await i18n.changeLanguage("en");
  }
});

afterEach(async () => {
  await act(async () => __resetCaptchaForTests());
  if (ORIGINAL_KEY === undefined) {
    delete process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  } else {
    process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = ORIGINAL_KEY;
  }
});

describe("CaptchaHost", () => {
  it("draws nothing while no sign-in waits for a token", async () => {
    await renderHost();
    expect(screen.queryByTestId("captcha-hidden", ALL)).toBeNull();
    expect(screen.queryByTestId("turnstile-webview", ALL)).toBeNull();
    expect(screen.queryByTestId("captcha-sheet", ALL)).toBeNull();
  });

  it("a waiting sign-in gets an invisible check whose token resolves it", async () => {
    await renderHost();
    const { pending } = await askForToken();
    const layer = screen.getByTestId("captcha-hidden", ALL);
    expect(layer.props.pointerEvents).toBe("none");
    expect(layer.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(layer.props.accessibilityElementsHidden).toBe(true);
    expect(screen.queryByTestId("captcha-sheet", ALL)).toBeNull();
    expect(screen.getByTestId("turnstile-webview", ALL).props.source.uri).toContain(
      "appearance=interaction-only",
    );

    await pageMessage({ type: "token", token: "tok-hidden" });
    await expect(pending).resolves.toBe("tok-hidden");
    expect(screen.queryByTestId("turnstile-webview", ALL)).toBeNull();
  });

  it("a failed check lets the sign-in go ahead without a token", async () => {
    await renderHost();
    const { pending } = await askForToken();
    await pageMessage({ type: "error", code: "300030" });
    await expect(pending).resolves.toBeNull();
    expect(screen.queryByTestId("captcha-hidden", ALL)).toBeNull();
  });

  it("a check that needs a tap opens the 'Quick check' sheet with a fresh widget; its token resolves the sign-in", async () => {
    await renderHost();
    const { pending } = await askForToken();
    await pageMessage({ type: "interactive" });

    expect(screen.getByTestId("captcha-sheet", ALL)).toBeTruthy();
    expect(screen.getByText("Quick check")).toBeTruthy();
    expect(screen.getByText("Tap the box to show you are a person.")).toBeTruthy();
    expect(screen.queryByTestId("captcha-hidden", ALL)).toBeNull();
    // Reachable by screen readers now (no ALL): the sheet is a real dialog.
    const webview = screen.getByTestId("turnstile-webview");
    expect(webview.props.source.uri).toContain("appearance=always");
    expect(webview.props.accessibilityLabel).toBe("Quick check");

    await pageMessage({ type: "token", token: "tok-tapped" });
    await expect(pending).resolves.toBe("tok-tapped");
    expect(screen.queryByTestId("captcha-sheet", ALL)).toBeNull();
  });

  it("'Not now' closes the sheet and the sign-in goes ahead without a token", async () => {
    await renderHost();
    const { pending } = await askForToken();
    await pageMessage({ type: "interactive" });
    const notNow = screen.getByTestId("captcha-not-now");
    expect(screen.getByText("Not now")).toBeTruthy();
    await fireEvent.press(notNow);
    await expect(pending).resolves.toBeNull();
    expect(screen.queryByTestId("captcha-sheet", ALL)).toBeNull();
  });

  it("passes the app's language and colour scheme to the widget", async () => {
    await renderHost();
    await askForToken();
    const uri = screen.getByTestId("turnstile-webview", ALL).props.source.uri as string;
    expect(uri).toContain("lang=en");
    expect(uri).toMatch(/theme=(light|dark)/);
  });
});
