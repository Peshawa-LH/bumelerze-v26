/**
 * app/+native-intent.tsx: how the iOS/Android app resolves the addresses it
 * is opened with, and that each link is noted for after onboarding. The
 * root layout must mount the hook that opens a noted link (read from the
 * source: rendering the root layout needs the whole app).
 */
import fs from "node:fs";
import path from "node:path";

import { useArrivedLinkStore } from "@/features/links/pending-link";
import { redirectSystemPath } from "../+native-intent";

beforeEach(() => {
  useArrivedLinkStore.setState({ arrived: null });
});

describe("redirectSystemPath", () => {
  it.each([
    ["https://app.bumelerze.com/e/bml20170001", "/event/bml20170001"],
    ["https://app.bumelerze.com/u/peshawa", "/u/peshawa"],
    ["https://app.bumelerze.com/home/join?code=AB&key=xy", "/home/join?code=AB&key=xy"],
    ["bumelerze://e/bml20170001", "/event/bml20170001"],
    ["bumelerze://event/bml20170001", "/event/bml20170001"],
    ["https://bumelerze.com/join?code=AB&key=xy", "/home/join?code=AB&key=xy"],
  ])("opens %s at %s and notes it", (url, expected) => {
    expect(redirectSystemPath({ path: url, initial: true })).toBe(expected);
    expect(useArrivedLinkStore.getState().arrived).toBe(expected);
  });

  it("starts at Home for an address that is not a screen, and stays put later", () => {
    const callback = "bumelerze://auth/callback?code=abc";
    expect(redirectSystemPath({ path: callback, initial: true })).toBe("/");
    expect(redirectSystemPath({ path: callback, initial: false })).toBeNull();
    expect(
      redirectSystemPath({ path: "https://bumelerze.com/privacy.html", initial: false }),
    ).toBeNull();
    expect(useArrivedLinkStore.getState().arrived).toBeNull();
  });

  it("hands the development build's own links back unchanged", () => {
    const devClient =
      "bumelerze://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8086";
    expect(redirectSystemPath({ path: devClient, initial: true })).toBe(devClient);
    expect(useArrivedLinkStore.getState().arrived).toBeNull();
  });

  it("does not note a plain start of the app", () => {
    expect(redirectSystemPath({ path: "bumelerze://", initial: true })).toBe("/");
    expect(useArrivedLinkStore.getState().arrived).toBeNull();
  });
});

describe("the root layout", () => {
  const source = fs.readFileSync(path.join(__dirname, "../_layout.tsx"), "utf8");

  it("opens a link kept during onboarding, before a requested tour", () => {
    const linkAt = source.search(/\busePendingLink\(\{/);
    const tourAt = source.search(/\buseLaunchPendingTour\(onboardingCompleted\)/);
    expect(linkAt).toBeGreaterThan(-1);
    expect(tourAt).toBeGreaterThan(linkAt);
  });
});
