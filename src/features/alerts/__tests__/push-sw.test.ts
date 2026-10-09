/**
 * public/push-sw.js (the web push service worker, migration 0062) run in a
 * sandbox with a fake `self`: it shows the localized notification it is
 * given, keeps every click inside the app's scope, and focuses an open app
 * window instead of opening a second one.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { runInNewContext } from "vm";

const SOURCE = readFileSync(join(__dirname, "../../../../public/push-sw.js"), "utf8");
const SCOPE = "https://bumelerze.com/app/";

type Listener = (event: Record<string, unknown>) => void;

function load(windows: { url: string; navigate?: jest.Mock; focus?: jest.Mock }[] = []) {
  const listeners: Record<string, Listener> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const waits: Promise<unknown>[] = [];
  const self = {
    registration: {
      scope: SCOPE,
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    location: { origin: "https://bumelerze.com" },
    skipWaiting: jest.fn(),
    clients: {
      claim: jest.fn(() => Promise.resolve()),
      matchAll: jest.fn(() => Promise.resolve(windows)),
      openWindow: jest.fn((url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      }),
    },
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
  };
  runInNewContext(SOURCE, { self, Date });
  const fire = async (type: string, event: Record<string, unknown>) => {
    listeners[type]?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { listeners, shown, opened, fire, self };
}

const pushEvent = (payload: unknown) => ({
  data: {
    json: () => {
      if (typeof payload === "string") throw new Error("not json");
      return payload;
    },
    text: () => String(payload),
  },
});

describe("push-sw.js", () => {
  it("has no fetch handler (never touches page loads)", () => {
    const { listeners } = load();
    expect(Object.keys(listeners).sort()).toEqual(["activate", "install", "notificationclick", "push"]);
  });

  it("shows the localized alert with tag, direction, icons and the in-scope link", async () => {
    const { fire, shown } = load();
    await fire(
      "push",
      pushEvent({
        title: "بوومەلەرزەیەکی ٤.٦ پلە",
        body: "٢٠ کم باشووری ڕۆژهەڵاتی هەولێرەوە",
        tag: "ev-bml2026abcd",
        path: "event/bml2026abcd",
        quiet: false,
        renotify: true,
        lang: "ckb",
        dir: "rtl",
        ts: 42,
      }),
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe("بوومەلەرزەیەکی ٤.٦ پلە");
    expect(shown[0]?.options).toMatchObject({
      tag: "ev-bml2026abcd",
      renotify: true,
      silent: false,
      dir: "rtl",
      lang: "ckb",
      timestamp: 42,
      icon: `${SCOPE}push-icon-192.png`,
      badge: `${SCOPE}push-badge.png`,
      data: { url: `${SCOPE}event/bml2026abcd` },
    });
  });

  it("a quiet summary is silent", async () => {
    const { fire, shown } = load();
    await fire("push", pushEvent({ title: "t", body: "b", tag: "bml-summary", quiet: true, path: "event/x" }));
    expect(shown[0]?.options.silent).toBe(true);
  });

  it("survives a payload that is not JSON, or none", async () => {
    const { fire, shown } = load();
    await fire("push", pushEvent("plain text"));
    await fire("push", { data: null });
    expect(shown[0]).toMatchObject({ title: "Bumelerze", options: { body: "plain text", tag: "bumelerze" } });
    expect(shown[1]?.title).toBe("Bumelerze");
  });

  it.each([
    "https://evil.example.com/x",
    "//evil.example.com",
    "../admin",
    "event/../../x",
    "javascript:alert(1)",
  ])("a path that leaves the app (%s) opens the app home instead", async (path) => {
    const { fire, shown } = load();
    await fire("push", pushEvent({ title: "t", path }));
    expect((shown[0]?.options.data as { url: string }).url).toBe(SCOPE);
  });

  it("a click opens the event when no app window is open", async () => {
    const { fire, opened } = load();
    const close = jest.fn();
    await fire("notificationclick", {
      notification: { close, data: { url: `${SCOPE}event/bml2026abcd` } },
    });
    expect(close).toHaveBeenCalled();
    expect(opened).toEqual([`${SCOPE}event/bml2026abcd`]);
  });

  it("a click reuses an open app window", async () => {
    const focus = jest.fn(() => Promise.resolve(null));
    const client = { url: `${SCOPE}`, focus, navigate: jest.fn() };
    client.navigate.mockImplementation(() => Promise.resolve(client));
    const { fire, opened } = load([client]);
    await fire("notificationclick", {
      notification: { close: jest.fn(), data: { url: `${SCOPE}event/bml2026abcd` } },
    });
    expect(client.navigate).toHaveBeenCalledWith(`${SCOPE}event/bml2026abcd`);
    expect(focus).toHaveBeenCalled();
    expect(opened).toEqual([]);
  });

  it("a click with an outside url goes to the app home", async () => {
    const { fire, opened } = load();
    await fire("notificationclick", {
      notification: { close: jest.fn(), data: { url: "https://evil.example.com/" } },
    });
    expect(opened).toEqual([SCOPE]);
  });
});
