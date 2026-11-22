import {
  buildTurnstilePageUrl,
  isAllowedTurnstileNavigation,
  isTurnstilePageUrl,
  parseTurnstileBridgeMessage,
} from "../bridge";
import { TURNSTILE_PAGE_URL, turnstileLanguageFor } from "../config";
import { TURNSTILE_TEST_SITE_KEYS } from "../test-keys";

const KEY = TURNSTILE_TEST_SITE_KEYS.passInvisible;
const PAGE = `${TURNSTILE_PAGE_URL}?sitekey=${KEY}&lang=en&theme=light&appearance=interaction-only`;

describe("buildTurnstilePageUrl", () => {
  it("opens the web app's check page (no .html: Pages would redirect) with its settings", () => {
    expect(
      buildTurnstilePageUrl({
        siteKey: KEY,
        language: "en",
        theme: "light",
        appearance: "interaction-only",
      }),
    ).toBe(PAGE);
    expect(TURNSTILE_PAGE_URL).toBe("https://app.bumelerze.com/turnstile");
  });

  it("refuses a key that cannot be one", () => {
    expect(
      buildTurnstilePageUrl({
        siteKey: "x&y=<script>",
        language: "en",
        theme: "dark",
        appearance: "always",
      }),
    ).toBeNull();
  });
});

describe("parseTurnstileBridgeMessage", () => {
  it("reads a token, a failure and a request for a tap from our page", () => {
    expect(parseTurnstileBridgeMessage('{"type":"token","token":"abc"}', PAGE)).toEqual({
      type: "token",
      token: "abc",
    });
    expect(parseTurnstileBridgeMessage('{"type":"error","code":"110200"}', PAGE)).toEqual(
      {
        type: "error",
        code: "110200",
      },
    );
    expect(parseTurnstileBridgeMessage('{"type":"interactive"}', PAGE)).toEqual({
      type: "interactive",
    });
    expect(parseTurnstileBridgeMessage('{"type":"timeout"}', PAGE)).toEqual({
      type: "timeout",
    });
    expect(parseTurnstileBridgeMessage('{"type":"expired"}', PAGE)).toEqual({
      type: "expired",
    });
  });

  it("ignores anything else: other pages, junk, unknown or malformed messages", () => {
    expect(
      parseTurnstileBridgeMessage(
        '{"type":"token","token":"abc"}',
        "https://evil.example/turnstile",
      ),
    ).toBeNull();
    expect(
      parseTurnstileBridgeMessage('{"type":"token","token":"abc"}', undefined),
    ).toBeNull();
    expect(parseTurnstileBridgeMessage("not json", PAGE)).toBeNull();
    expect(parseTurnstileBridgeMessage('{"type":"token","token":""}', PAGE)).toBeNull();
    expect(parseTurnstileBridgeMessage('{"type":"token","token":42}', PAGE)).toBeNull();
    expect(parseTurnstileBridgeMessage('{"type":"steal"}', PAGE)).toBeNull();
  });
});

describe("navigation inside the WebView", () => {
  it("stays on our check page; Turnstile's own frames may load", () => {
    expect(isTurnstilePageUrl(PAGE)).toBe(true);
    expect(isAllowedTurnstileNavigation(PAGE, true)).toBe(true);
    expect(
      isAllowedTurnstileNavigation("https://app.bumelerze.com/turnstile.html?x=1", true),
    ).toBe(true);
    expect(
      isAllowedTurnstileNavigation("https://challenges.cloudflare.com/cdn-cgi/x", false),
    ).toBe(true);
    expect(
      isAllowedTurnstileNavigation("https://www.cloudflare.com/privacypolicy/", true),
    ).toBe(false);
    expect(isAllowedTurnstileNavigation("https://app.bumelerze.com/", true)).toBe(false);
    expect(
      isAllowedTurnstileNavigation("https://app.bumelerze.com/turnstiles", true),
    ).toBe(false);
  });
});

describe("turnstileLanguageFor", () => {
  it("Arabic and English as the app; Sorani and Kurmanji follow the browser", () => {
    expect(turnstileLanguageFor("ar")).toBe("ar");
    expect(turnstileLanguageFor("en")).toBe("en");
    expect(turnstileLanguageFor("ckb")).toBe("auto");
    expect(turnstileLanguageFor("kmr")).toBe("auto");
  });
});
