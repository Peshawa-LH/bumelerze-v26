import { act, render } from "@testing-library/react-native";

import i18n from "@/i18n";

import { documentTitleFor, TITLE_SETTLE_CHECKS_MS, useDocumentTitle } from "../document-title.web";

/**
 * Review B-23: the browser tab read "Bumelerze" on every screen. The hook
 * reads the focused screen's header title through the navigation container
 * (Expo Router disables React Navigation's own document title).
 */
let mockPathname = "/";
let mockOptions: { title?: unknown } | undefined;
let mockReady = true;
const stateListeners = new Set<() => void>();
const mockRef = {
  isReady: () => mockReady,
  getCurrentOptions: () => mockOptions,
  addListener: jest.fn((type: string, listener: () => void) => {
    if (type === "state") stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  }),
};
jest.mock("expo-router", () => ({
  useNavigationContainerRef: () => mockRef,
  usePathname: () => mockPathname,
}));

function Probe() {
  useDocumentTitle();
  return null;
}

const doc = globalThis as { document?: { title: string } };
const hadDocument = typeof doc.document !== "undefined";

describe("documentTitleFor", () => {
  const t = (key: string, values?: Record<string, string>) => i18n.t(key, values ?? {});

  it("Home is the brand alone", () => {
    expect(documentTitleFor(null, "/", t)).toBe("Bumelerze");
    expect(documentTitleFor("Home", "/", t)).toBe("Bumelerze");
  });

  it("a pushed screen: its header title, then the brand", () => {
    expect(documentTitleFor("Settings", "/settings", t)).toBe("Settings · Bumelerze");
    expect(documentTitleFor("World Catalog", "/world", t)).toBe("World Catalog · Bumelerze");
  });

  it("a tab root without a header title uses the tab's name", () => {
    expect(documentTitleFor(null, "/settings", t)).toBe("Settings · Bumelerze");
    expect(documentTitleFor(null, "/map/", t)).toBe("Map · Bumelerze");
  });

  it("no title anywhere: the brand", () => {
    expect(documentTitleFor(null, "/somewhere", t)).toBe("Bumelerze");
  });
});

describe("useDocumentTitle", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    if (!hadDocument) {
      doc.document = { title: "" };
    }
    mockPathname = "/";
    mockOptions = undefined;
    mockReady = true;
    stateListeners.clear();
  });
  afterEach(() => {
    jest.useRealTimers();
    if (!hadDocument) {
      delete doc.document;
    }
  });

  it("sets the title from the focused screen's options and follows navigation", async () => {
    mockPathname = "/world";
    mockOptions = { title: "World Catalog" };
    await render(<Probe />);
    expect(doc.document!.title).toBe("World Catalog · Bumelerze");

    mockOptions = { title: "Significant Events" };
    await act(async () => {
      for (const listener of stateListeners) listener();
    });
    expect(doc.document!.title).toBe("Significant Events · Bumelerze");
  });

  it("[SDK 58] picks up a title the screen sets after it has mounted (no options event)", async () => {
    jest.useFakeTimers();
    mockPathname = "/u/sara";
    mockOptions = { title: "Profile" };
    await render(<Probe />);
    expect(doc.document!.title).toBe("Profile · Bumelerze");

    // The profile arrives and the screen sets its own title; nothing navigates.
    mockOptions = { title: "@sara" };
    await act(async () => {
      jest.advanceTimersByTime(TITLE_SETTLE_CHECKS_MS[1]!);
    });
    expect(doc.document!.title).toBe("@sara · Bumelerze");
  });

  it("listens only to navigation, the one event Expo Router 58's container reports", async () => {
    await render(<Probe />);
    expect(mockRef.addListener.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["state"]),
    );
    expect(mockRef.addListener.mock.calls.every(([type]) => type === "state")).toBe(true);
  });

  it("Home reads Bumelerze; a tab root reads the tab's name", async () => {
    await render(<Probe />);
    expect(doc.document!.title).toBe("Bumelerze");
    mockPathname = "/settings";
    await render(<Probe />);
    expect(doc.document!.title).toBe("Settings · Bumelerze");
  });

  it("does not ask the container before it is ready", async () => {
    mockReady = false;
    mockPathname = "/profile";
    await render(<Probe />);
    expect(doc.document!.title).toBe("Profile · Bumelerze");
  });
});
