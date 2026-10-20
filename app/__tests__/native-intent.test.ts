/**
 * app/+native-intent.tsx: how the iOS/Android app resolves the addresses it
 * is opened with.
 */
import { redirectSystemPath } from "../+native-intent";

describe("redirectSystemPath", () => {
  it.each([
    ["https://app.bumelerze.com/e/bml20170001", "/event/bml20170001"],
    ["https://app.bumelerze.com/u/peshawa", "/u/peshawa"],
    ["https://app.bumelerze.com/home/join?code=AB&key=xy", "/home/join?code=AB&key=xy"],
    ["bumelerze://e/bml20170001", "/event/bml20170001"],
    ["bumelerze://event/bml20170001", "/event/bml20170001"],
    ["https://bumelerze.com/join?code=AB&key=xy", "/home/join?code=AB&key=xy"],
  ])("opens %s at %s", (url, expected) => {
    expect(redirectSystemPath({ path: url, initial: true })).toBe(expected);
  });

  it("starts at Home for an address that is not a screen, and stays put later", () => {
    const callback = "bumelerze://auth/callback?code=abc";
    expect(redirectSystemPath({ path: callback, initial: true })).toBe("/");
    expect(redirectSystemPath({ path: callback, initial: false })).toBeNull();
    expect(
      redirectSystemPath({ path: "https://bumelerze.com/privacy.html", initial: false }),
    ).toBeNull();
  });

  it("hands the development build's own links back unchanged", () => {
    const devClient =
      "bumelerze://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8086";
    expect(redirectSystemPath({ path: devClient, initial: true })).toBe(devClient);
  });
});
