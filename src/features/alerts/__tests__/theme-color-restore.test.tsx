/**
 * @jest-environment jsdom
 *
 * Review note 11.2 (2026-10-13): after opening Settings -> Notifications on
 * iPhone Safari, the browser bars turned red and stayed red on every page.
 * Cause: the tester panel linked the web-app manifest (theme_color = the
 * logo's Signal Red) into <head> and never removed it, and Safari colours its
 * bars from the manifest when the page has no theme-color meta. These tests
 * use a REAL (jsdom) document: while the panel is open the theme-color is the
 * app's own background colour, and after it closes nothing it added is left.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

import { AlertsTesterPanel } from "../components/AlertsTesterPanel";
import type { AlertsTransport } from "../transport";
import type { AlertAccess } from "../types";
import { ensureWebAppManifest, type BrowserEnv } from "../web-push";

// expo-router's real module needs URLSearchParams, which jsdom here lacks;
// the panel itself never navigates.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  Stack: { Screen: () => null },
}));

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: () => Promise.resolve(),
}));

const TESTER: AlertAccess = { mode: "testers", tester: true, enabled: true, canManage: false };

function realDocumentEnv(): BrowserEnv {
  return {
    navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
    window: {},
    document: document as unknown as NonNullable<BrowserEnv["document"]>,
  };
}

function themeColor(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null;
}

const originalOS = Platform.OS;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  document.head.innerHTML = "";
});

afterEach(() => {
  cleanup();
  Platform.OS = originalOS;
  document.head.innerHTML = "";
});

describe("ensureWebAppManifest (real document)", () => {
  it("sets a neutral theme-color while open and removes everything on cleanup", () => {
    const restore = ensureWebAppManifest(realDocumentEnv(), "", "#FFFFFF");
    expect(document.querySelector('link[rel="manifest"]')).not.toBeNull();
    expect(themeColor()).toBe("#FFFFFF");

    restore();
    expect(document.querySelector('link[rel="manifest"]')).toBeNull();
    expect(document.querySelector('link[rel="apple-touch-icon"]')).toBeNull();
    expect(document.querySelector('meta[name="apple-mobile-web-app-capable"]')).toBeNull();
    expect(themeColor()).toBeNull();
    expect(document.head.children).toHaveLength(0);
  });

  it("puts back a theme-color that was already on the page", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#123456");
    document.head.appendChild(meta);

    const restore = ensureWebAppManifest(realDocumentEnv(), "", "#141414");
    expect(themeColor()).toBe("#141414");
    restore();
    expect(themeColor()).toBe("#123456");
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });

  it("leaves nodes it did not add alone", () => {
    const link = document.createElement("link");
    link.setAttribute("rel", "manifest");
    link.setAttribute("href", "/other.webmanifest");
    document.head.appendChild(link);

    const restore = ensureWebAppManifest(realDocumentEnv(), "", "#FFFFFF");
    restore();
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute("href")).toBe(
      "/other.webmanifest",
    );
  });
});

describe("AlertsTesterPanel on the web", () => {
  it("never leaves the manifest or a changed theme-color behind after unmount", async () => {
    Platform.OS = "web";
    const transport = {
      fetchAccess: jest.fn(),
      registerWebPush: jest.fn(),
      unregisterWebPush: jest.fn(),
      savePreferences: jest.fn(() => Promise.resolve()),
      sendTest: jest.fn(),
      fetchOverview: jest.fn(),
      setMode: jest.fn(),
      addTester: jest.fn(),
      removeTester: jest.fn(),
    } as unknown as AlertsTransport;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    const view = await render(
      <QueryClientProvider client={client}>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 360, height: 640 },
            insets: { top: 0, left: 0, right: 0, bottom: 0 },
          }}
        >
          <AlertsTesterPanel access={TESTER} transport={transport} env={realDocumentEnv()} />
        </SafeAreaProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("alerts-tester-panel")).toBeTruthy();
    expect(document.querySelector('link[rel="manifest"]')).not.toBeNull();
    const whileOpen = themeColor();
    expect(whileOpen).not.toBeNull();
    // Never the manifest's Signal Red.
    expect(whileOpen?.toUpperCase()).not.toBe("#C8202F");

    await view.unmount();
    expect(document.querySelector('link[rel="manifest"]')).toBeNull();
    expect(themeColor()).toBeNull();
  });
});
