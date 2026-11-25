import * as fs from "node:fs";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { TURNSTILE_TEST_SITE_KEYS } from "../test-keys";

import { parseTurnstileBridgeMessage } from "../bridge";
import { TURNSTILE_PAGE_URL, TURNSTILE_SCRIPT_URL } from "../config";

/**
 * `public/turnstile.html`, the page the iOS/Android app opens in its hidden
 * WebView (A1.4), run in a sandbox: it draws one widget from the query
 * string's settings (each checked against a fixed list) and posts messages
 * the app's bridge (`bridge.ts`) accepts. Also checks that the hosting
 * headers let Cloudflare's script and frame load.
 */

const PUBLIC_DIR = path.join(__dirname, "../../../../public");
const PAGE_HTML = fs.readFileSync(path.join(PUBLIC_DIR, "turnstile.html"), "utf8");
const KEY = TURNSTILE_TEST_SITE_KEYS.passInvisible;

function inlineScript(html: string): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) {
    throw new Error("turnstile.html: no inline script");
  }
  return match[1];
}

type Params = Record<string, unknown>;

function runPage(search: string, withBridge = true) {
  const posted: string[] = [];
  const scripts: {
    src: string;
    async: boolean;
    onload: (() => void) | null;
    onerror: (() => void) | null;
  }[] = [];
  const renders: { target: unknown; params: Params }[] = [];
  const window: Record<string, unknown> = {
    location: { search },
  };
  if (withBridge) {
    window.ReactNativeWebView = { postMessage: (data: string) => posted.push(data) };
  }
  const document = {
    createElement: () => {
      const script = { src: "", async: false, onload: null, onerror: null };
      return script;
    },
    head: {
      appendChild: (script: (typeof scripts)[number]) => scripts.push(script),
    },
  };
  runInNewContext(inlineScript(PAGE_HTML), {
    window,
    document,
    URLSearchParams,
    JSON,
    String,
  });
  const loadApi = (renderResult: unknown = "w1") => {
    window.turnstile = {
      render: (target: unknown, params: Params) => {
        renders.push({ target, params });
        return renderResult;
      },
    };
    scripts[0]?.onload?.();
  };
  const call = (name: string, ...args: unknown[]) =>
    (renders[0]?.params[name] as (...a: unknown[]) => unknown)(...args);
  const messages = () =>
    posted.map((data) =>
      parseTurnstileBridgeMessage(data, `${TURNSTILE_PAGE_URL}${search}`),
    );
  return { posted, scripts, renders, loadApi, call, messages };
}

const GOOD = `?sitekey=${KEY}&lang=ar&theme=dark&appearance=interaction-only`;

describe("public/turnstile.html", () => {
  it("loads Cloudflare's script (explicit rendering) and draws one widget with the given settings", () => {
    const page = runPage(GOOD);
    expect(page.scripts).toHaveLength(1);
    expect(page.scripts[0]!.src).toBe(TURNSTILE_SCRIPT_URL);
    page.loadApi();
    expect(page.renders).toHaveLength(1);
    expect(page.renders[0]!.target).toBe("#widget");
    expect(page.renders[0]!.params).toMatchObject({
      sitekey: KEY,
      language: "ar",
      theme: "dark",
      appearance: "interaction-only",
      size: "normal",
      retry: "never",
      "refresh-expired": "never",
      "response-field": false,
    });
  });

  it("posts the token as the bridge expects, once", () => {
    const page = runPage(GOOD);
    page.loadApi();
    page.call("callback", "tok-1");
    page.call("callback", "tok-2");
    page.call("error-callback", "x");
    expect(page.messages()).toEqual([{ type: "token", token: "tok-1" }]);
  });

  it("reports a needed tap without ending, then the outcome", () => {
    const page = runPage(GOOD);
    page.loadApi();
    page.call("before-interactive-callback");
    page.call("timeout-callback");
    expect(page.messages()).toEqual([{ type: "interactive" }, { type: "timeout" }]);
  });

  it("errors are reported with a short code, and count as handled", () => {
    const page = runPage(GOOD);
    page.loadApi();
    expect(page.call("error-callback", 110200)).toBe(true);
    expect(page.messages()).toEqual([{ type: "error", code: "110200" }]);
  });

  it("a script that cannot load, or a widget that cannot be drawn, is an error", () => {
    const blocked = runPage(GOOD);
    blocked.scripts[0]!.onerror?.();
    expect(blocked.messages()).toEqual([{ type: "error", code: "script" }]);

    const broken = runPage(GOOD);
    broken.loadApi(null);
    expect(broken.messages()).toEqual([{ type: "error", code: "render" }]);
  });

  it("refuses a missing or odd site key without loading anything", () => {
    for (const search of ["", "?sitekey=", "?sitekey=%3Cscript%3E", "?sitekey=a b"]) {
      const page = runPage(search);
      expect(page.scripts).toHaveLength(0);
      expect(page.messages()).toEqual([{ type: "error", code: "sitekey" }]);
    }
  });

  it("only takes language, theme and appearance from fixed lists", () => {
    const page = runPage(`?sitekey=${KEY}&lang=xx&theme=neon&appearance=execute`);
    page.loadApi();
    expect(page.renders[0]!.params).toMatchObject({
      language: "auto",
      theme: "light",
      appearance: "interaction-only",
    });
  });

  it("the visible sheet's page draws the full-width widget and never asks for the sheet again", () => {
    const page = runPage(`?sitekey=${KEY}&lang=en&theme=light&appearance=always`);
    page.loadApi();
    expect(page.renders[0]!.params).toMatchObject({
      appearance: "always",
      size: "flexible",
    });
    page.call("before-interactive-callback");
    expect(page.messages()).toEqual([]);
  });

  it("opened in a plain browser (no app bridge) it posts nothing and does not break", () => {
    const page = runPage(GOOD, false);
    page.loadApi();
    page.call("callback", "tok");
    expect(page.posted).toEqual([]);
  });

  it("is not indexed by search engines", () => {
    expect(PAGE_HTML).toContain('<meta name="robots" content="noindex" />');
  });
});

describe("public/_headers lets Turnstile load", () => {
  const headers = fs.readFileSync(path.join(PUBLIC_DIR, "_headers"), "utf8");

  it("every Content-Security-Policy lets the Turnstile script and frame load", () => {
    const policies = headers
      .split("\n")
      .filter((line) => /^\s*Content-Security-Policy:/i.test(line))
      .map((line) => line.replace(/^\s*Content-Security-Policy:\s*/i, ""));
    // The map worker and the catalog's database worker never load Turnstile;
    // every other policy (the page, /turnstile) must allow it through
    // script-src and frame-src, or through default-src where those two are absent.
    const relevant = policies.filter(
      (p) => !/script-src 'self' '(unsafe-eval|wasm-unsafe-eval)'/.test(p),
    );
    expect(relevant.length).toBeGreaterThan(0);
    for (const policy of relevant) {
      for (const directive of ["script-src", "frame-src"]) {
        const own = new RegExp(`(?:^|;)\\s*${directive}\\s+([^;]*)`, "i").exec(policy);
        const fallback = new RegExp(`(?:^|;)\\s*default-src\\s+([^;]*)`, "i").exec(policy);
        const value = own?.[1] ?? fallback?.[1];
        if (value !== undefined) {
          expect(`${directive}: ${value}`).toContain("https://challenges.cloudflare.com");
        }
      }
    }
  });

  it("sends the page's origin with cross-site requests (Turnstile checks the hostname)", () => {
    expect(headers).not.toMatch(/Referrer-Policy:\s*no-referrer\b/i);
  });
});
