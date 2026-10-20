import { buildJoinLink } from "@/features/building/constants";
import { buildShareUrl } from "@/features/share/caption";
import {
  APP_SCHEME,
  NATIVE_AUTH_CALLBACK_URL,
  isOnboardingPath,
  resolveIncomingLink,
} from "../incoming";

function pathOf(url: string): string | null {
  const link = resolveIncomingLink(url);
  return link.kind === "route" ? link.path : null;
}

describe("resolveIncomingLink: app.bumelerze.com (universal links)", () => {
  it.each([
    // The short event link goes straight to the event page, as app/e/[id].tsx
    // does on the web.
    ["https://app.bumelerze.com/e/bml20170001", "/event/bml20170001"],
    ["https://app.bumelerze.com/e/bml20170001/", "/event/bml20170001"],
    ["https://app.bumelerze.com/e/us7000abcd?from=qr", "/event/us7000abcd?from=qr"],
    ["https://app.bumelerze.com/event/bml20170001", "/event/bml20170001"],
    ["https://app.bumelerze.com/event-hub/bml20170001", "/event-hub/bml20170001"],
    ["https://app.bumelerze.com/u/peshawa", "/u/peshawa"],
    // Usernames may hold dots: not a file.
    ["https://app.bumelerze.com/u/john.doe", "/u/john.doe"],
    ["https://app.bumelerze.com/u/john.doe/people", "/u/john.doe/people"],
    [
      "https://app.bumelerze.com/home/join?code=AB12&key=x-y",
      "/home/join?code=AB12&key=x-y",
    ],
    ["https://app.bumelerze.com/significant", "/significant"],
    ["https://app.bumelerze.com/", "/"],
    ["https://app.bumelerze.com", "/"],
    // Host case, www and the #part do not matter; the query travels along.
    ["HTTPS://APP.BUMELERZE.COM/e/bml20170001#top", "/event/bml20170001"],
    ["https://www.app.bumelerze.com/u/peshawa", "/u/peshawa"],
    ["https://app.bumelerze.com//event//bml1", "/event/bml1"],
  ])("%s -> %s", (url, path) => {
    expect(pathOf(url)).toBe(path);
  });

  it.each([
    "https://app.bumelerze.com/data/faults.geojson",
    "https://app.bumelerze.com/_expo/static/js/web/entry.js",
    "https://app.bumelerze.com/assets/vendor/x.ttf",
    "https://app.bumelerze.com/.well-known/apple-app-site-association",
    "https://app.bumelerze.com/push-sw.js",
    "https://app.bumelerze.com/robots.txt",
  ])("static file %s is not a screen", (url) => {
    expect(resolveIncomingLink(url)).toEqual({ kind: "ignore" });
  });

  it("resolves the links the app itself shares and prints in QR codes", () => {
    expect(pathOf(buildShareUrl("bml20170001"))).toBe("/event/bml20170001");
    expect(pathOf(buildJoinLink("AB12CD", "k3y_v4lue"))).toBe(
      "/home/join?code=AB12CD&key=k3y_v4lue",
    );
  });
});

describe("resolveIncomingLink: bumelerze:// (the app's own scheme)", () => {
  it.each([
    ["bumelerze://e/bml20170001", "/event/bml20170001"],
    ["bumelerze://event/bml20170001", "/event/bml20170001"],
    ["bumelerze:///event/bml20170001", "/event/bml20170001"],
    ["bumelerze://u/peshawa", "/u/peshawa"],
    ["bumelerze://home/join?code=AB&key=xy", "/home/join?code=AB&key=xy"],
    ["bumelerze://notification-settings", "/notification-settings"],
    ["bumelerze://", "/"],
    ["bumelerze:///", "/"],
  ])("%s -> %s", (url, path) => {
    expect(pathOf(url)).toBe(path);
  });

  it("leaves the sign-in return to the sign-in session", () => {
    expect(NATIVE_AUTH_CALLBACK_URL).toBe(`${APP_SCHEME}://auth/callback`);
    expect(resolveIncomingLink(NATIVE_AUTH_CALLBACK_URL)).toEqual({ kind: "ignore" });
    expect(resolveIncomingLink(`${NATIVE_AUTH_CALLBACK_URL}?code=abc`)).toEqual({
      kind: "ignore",
    });
    expect(
      resolveIncomingLink(`${NATIVE_AUTH_CALLBACK_URL}#access_token=a&refresh_token=b`),
    ).toEqual({ kind: "ignore" });
  });

  it("passes the development build's own links through", () => {
    expect(
      resolveIncomingLink(
        "bumelerze://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8086",
      ),
    ).toEqual({ kind: "passthrough" });
    expect(resolveIncomingLink("exp+bumelerze://expo-development-client/?url=x")).toEqual(
      {
        kind: "passthrough",
      },
    );
    expect(resolveIncomingLink("exp://192.168.1.2:8081/--/event/1")).toEqual({
      kind: "passthrough",
    });
  });
});

describe("resolveIncomingLink: bumelerze.com (the website's forwards)", () => {
  it.each([
    ["https://bumelerze.com/e/bml20170001", "/event/bml20170001"],
    ["https://bumelerze.com/e/bml20170001/?x=1", "/event/bml20170001?x=1"],
    ["https://bumelerze.com/u/peshawa", "/u/peshawa"],
    ["https://www.bumelerze.com/join?code=AB&key=xy", "/home/join?code=AB&key=xy"],
    ["https://bumelerze.com/join/?code=AB&key=xy", "/home/join?code=AB&key=xy"],
    ["https://bumelerze.com/app", "/"],
    ["https://bumelerze.com/app/", "/"],
    ["https://bumelerze.com/app/index.html", "/"],
    ["https://bumelerze.com/app/event/bml1", "/event/bml1"],
    // An old /app address of a short link ends where the web ends.
    ["https://bumelerze.com/app/e/bml1", "/event/bml1"],
  ])("%s -> %s", (url, path) => {
    expect(pathOf(url)).toBe(path);
  });

  it.each([
    "https://bumelerze.com/",
    "https://bumelerze.com/privacy.html",
    "https://bumelerze.com/handbook.html",
    "https://bumelerze.com/e/",
  ])("website page %s opens nothing in the app", (url) => {
    expect(resolveIncomingLink(url)).toEqual({ kind: "ignore" });
  });
});

describe("resolveIncomingLink: anything else", () => {
  it("reads plain paths like app addresses", () => {
    expect(pathOf("/e/bml1")).toBe("/event/bml1");
    expect(pathOf("event/bml1?x=1")).toBe("/event/bml1?x=1");
    expect(pathOf("/")).toBe("/");
    expect(pathOf("")).toBe("/");
  });

  it("opens nothing for other web hosts", () => {
    expect(resolveIncomingLink("https://example.com/e/bml1")).toEqual({ kind: "ignore" });
  });

  it("never throws on odd input", () => {
    for (const odd of ["::", "bumelerze:e/1", "mailto:a@b.c", "%%%", "?", "#"]) {
      expect(() => resolveIncomingLink(odd)).not.toThrow();
    }
  });
});

describe("isOnboardingPath", () => {
  it.each([
    ["/onboarding", true],
    ["/onboarding/language", true],
    ["/onboarding/done?x=1", true],
    ["/onboardingx", false],
    ["/event/bml1", false],
    ["/", false],
  ])("%s -> %s", (path, expected) => {
    expect(isOnboardingPath(path)).toBe(expected);
  });
});
