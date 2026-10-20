import { Linking } from "react-native";

import { openLink } from "../open-link";

const mockOpenBrowser = jest.fn();
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowser(...args),
}));

/** Item 21 of the iOS parity list: on the iPhone, `Linking.openURL` threw the
 * person out to Safari (privacy policy, Atlas PDF, MapTiler logo). The web
 * opens a new tab and the app stays where it was; the phone's equivalent is
 * the in-app browser sheet. */
describe("openLink", () => {
  let openURL: jest.SpyInstance;

  beforeEach(() => {
    mockOpenBrowser.mockReset().mockResolvedValue({ type: "dismiss" });
    openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
  });
  afterEach(() => {
    openURL.mockRestore();
  });

  it("opens a web page in the in-app browser on a phone, never in Safari", async () => {
    await openLink("https://bumelerze.com/privacy");
    expect(mockOpenBrowser).toHaveBeenCalledWith(
      "https://bumelerze.com/privacy",
      expect.objectContaining({ dismissButtonStyle: "done" }),
    );
    expect(openURL).not.toHaveBeenCalled();
  });

  it("hands a non-web link (mail) to the system", async () => {
    await openLink("mailto:hello@bumelerze.com");
    expect(openURL).toHaveBeenCalledWith("mailto:hello@bumelerze.com");
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it("falls back to the system when the in-app browser refuses", async () => {
    mockOpenBrowser.mockRejectedValue(new Error("Another WebBrowser is already being presented."));
    await openLink("https://example.test/report.pdf");
    expect(openURL).toHaveBeenCalledWith("https://example.test/report.pdf");
  });

  it("rejects when nothing can open the link, so the caller can say so", async () => {
    mockOpenBrowser.mockRejectedValue(new Error("refused"));
    openURL.mockRejectedValue(new Error("no handler"));
    await expect(openLink("https://example.test/report.pdf")).rejects.toThrow("no handler");
  });
});
