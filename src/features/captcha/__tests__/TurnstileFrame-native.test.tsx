import { render } from "@testing-library/react-native";
import { TURNSTILE_TEST_SITE_KEYS } from "../test-keys";

import { TURNSTILE_PAGE_URL } from "../config";

import type { TurnstileFrameProps } from "../frame-types";
import { TurnstileFrame } from "../TurnstileFrame";

/**
 * iOS/Android bridge (A1.4), with react-native-webview replaced by a plain
 * View (jest.setup.js): the WebView opens our check page with the settings,
 * and only our page's well-formed messages become an outcome — exactly one.
 */

const KEY = TURNSTILE_TEST_SITE_KEYS.passInvisible;

async function setup(overrides: Partial<TurnstileFrameProps> = {}) {
  const props: TurnstileFrameProps = {
    siteKey: KEY,
    visible: false,
    language: "en",
    theme: "dark",
    accessibilityLabel: "Quick check",
    onToken: jest.fn(),
    onFailure: jest.fn(),
    onInteractive: jest.fn(),
    ...overrides,
  };
  const screen = await render(<TurnstileFrame {...props} />);
  const webview = () => screen.getByTestId("turnstile-webview");
  const message = (data: unknown, url = webview().props.source.uri as string) =>
    webview().props.onMessage({
      nativeEvent: { data: typeof data === "string" ? data : JSON.stringify(data), url },
    });
  return { props, screen, webview, message };
}

describe("TurnstileFrame (iOS/Android WebView bridge)", () => {
  it("opens https://app.bumelerze.com/turnstile with the key, language, theme and appearance", async () => {
    const { webview } = await setup();
    expect(webview().props.source).toEqual({
      uri: `${TURNSTILE_PAGE_URL}?sitekey=${KEY}&lang=en&theme=dark&appearance=interaction-only`,
    });
    expect(webview().props.accessibilityLabel).toBe("Quick check");
    expect(webview().props.setSupportMultipleWindows).toBe(false);
  });

  it("the visible sheet asks for the always-drawn widget", async () => {
    const { webview } = await setup({ visible: true });
    expect(webview().props.source.uri).toContain("appearance=always");
  });

  it("a token from our page reaches onToken, once", async () => {
    const { props, message } = await setup();
    message({ type: "token", token: "tok-1" });
    message({ type: "token", token: "tok-2" });
    message({ type: "error", code: "x" });
    expect(props.onToken).toHaveBeenCalledTimes(1);
    expect(props.onToken).toHaveBeenCalledWith("tok-1");
    expect(props.onFailure).not.toHaveBeenCalled();
  });

  it("ignores messages from any other page and junk", async () => {
    const { props, message } = await setup();
    message({ type: "token", token: "forged" }, "https://evil.example/turnstile");
    message("{not json");
    message({ type: "token" });
    expect(props.onToken).not.toHaveBeenCalled();
    expect(props.onFailure).not.toHaveBeenCalled();
  });

  it("a widget error, a page that fails to load or an HTTP error is a failure, once", async () => {
    const first = await setup();
    first.message({ type: "error", code: "110200" });
    first.webview().props.onError({ nativeEvent: {} });
    expect(first.props.onFailure).toHaveBeenCalledTimes(1);

    const offline = await setup();
    offline.webview().props.onError({ nativeEvent: { code: -1009 } });
    expect(offline.props.onFailure).toHaveBeenCalledTimes(1);

    const http = await setup();
    http.webview().props.onHttpError({ nativeEvent: { statusCode: 404 } });
    expect(http.props.onFailure).toHaveBeenCalledTimes(1);
  });

  it("'needs a tap' is passed on while hidden, and never from the visible sheet", async () => {
    const hidden = await setup();
    hidden.message({ type: "interactive" });
    expect(hidden.props.onInteractive).toHaveBeenCalledTimes(1);
    expect(hidden.props.onFailure).not.toHaveBeenCalled();

    const visible = await setup({ visible: true });
    visible.message({ type: "interactive" });
    expect(visible.props.onInteractive).not.toHaveBeenCalled();
  });

  it("never leaves the check page (a link in the widget does not replace it)", async () => {
    const { webview } = await setup();
    const allow = webview().props.onShouldStartLoadWithRequest;
    expect(allow({ url: webview().props.source.uri, isTopFrame: true })).toBe(true);
    expect(allow({ url: "https://challenges.cloudflare.com/x", isTopFrame: false })).toBe(
      true,
    );
    expect(
      allow({ url: "https://www.cloudflare.com/privacypolicy/", isTopFrame: true }),
    ).toBe(false);
  });

  it("an impossible key renders nothing and fails instead of crashing", async () => {
    const { props, screen } = await setup({ siteKey: "bad key" });
    expect(screen.queryByTestId("turnstile-webview")).toBeNull();
    expect(props.onFailure).toHaveBeenCalledTimes(1);
  });
});
