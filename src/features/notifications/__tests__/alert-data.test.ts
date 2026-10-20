/**
 * What a tapped alert opens, read from the `data` send-alerts puts in every
 * Expo push ({ path, tag }), with the web service worker's rule for paths:
 * only simple in-app paths, never another site.
 */
import { hrefForAlertPath, readAlertData } from "../alert-data";

describe("readAlertData", () => {
  it("reads the path and tag send-alerts sends", () => {
    expect(readAlertData({ path: "event/bml2026abcd", tag: "ev-bml2026abcd" })).toEqual({
      path: "event/bml2026abcd",
      tag: "ev-bml2026abcd",
    });
  });

  it("a local notification (the rehearsal) has neither", () => {
    expect(readAlertData({})).toEqual({ path: null, tag: null });
    expect(readAlertData(undefined)).toEqual({ path: null, tag: null });
    expect(readAlertData(null)).toEqual({ path: null, tag: null });
  });

  it("ignores fields of the wrong type or size instead of failing", () => {
    expect(readAlertData({ path: 42, tag: ["x"] })).toEqual({ path: null, tag: null });
    expect(readAlertData({ path: "x".repeat(201), tag: "ok" })).toEqual({ path: null, tag: "ok" });
    expect(readAlertData("event/bml2026abcd")).toEqual({ path: null, tag: null });
  });
});

describe("hrefForAlertPath", () => {
  it("an alert, an upgrade or a summary opens the event page", () => {
    expect(hrefForAlertPath("event/bml2026abcd")).toEqual({
      pathname: "/event/[id]",
      params: { id: "bml2026abcd" },
    });
  });

  it("the test alert opens Notification Settings", () => {
    expect(hrefForAlertPath("notification-settings")).toBe("/notification-settings");
  });

  it.each([
    ["https://evil.example.com/x"],
    ["//evil.example.com"],
    ["event//bml2026abcd"],
    ["/event/bml2026abcd"],
    ["event/bml2026abcd?x=1"],
    ["../admin"],
    ["event/bml 2026"],
    [""],
  ])("never opens %s", (path) => {
    expect(hrefForAlertPath(path)).toBeNull();
  });

  it("no path: nothing to open", () => {
    expect(hrefForAlertPath(null)).toBeNull();
  });
});
