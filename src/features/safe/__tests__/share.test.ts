import { Share } from "react-native";
import * as Clipboard from "expo-clipboard";

import i18n from "@/i18n";

import { buildSafeShareMessage, shareSafeMessage } from "../share";

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

// 14:21 local time on the test machine's zone.
const ORIGIN = new Date(2026, 9, 8, 14, 21, 0).getTime();

describe("I'm safe share message", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("names the earthquake by its time only", async () => {
    await i18n.changeLanguage("en");
    const text = buildSafeShareMessage(i18n.t, "en", ORIGIN);
    expect(text).toContain("2:21");
    expect(text).toContain("PM");
    expect(text).toMatch(/^I'm safe after the earthquake at/);
    expect(text).toContain("Bumelerze");
  });

  it.each(["en", "ckb", "kmr", "ar"])(
    "%s: no link, no coordinates, no place",
    async (locale) => {
      await i18n.changeLanguage(locale);
      const text = buildSafeShareMessage(i18n.t, locale, ORIGIN);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/https?:|www\.|bumelerze\.com/i);
      expect(text).not.toMatch(/\d+\.\d{2,}/); // no decimal coordinates
      expect(text).not.toMatch(/Halabja|Erbil|Hawler|km/i);
      expect(text).not.toContain("{{");
    },
  );

  it("works without an earthquake time", async () => {
    await i18n.changeLanguage("en");
    expect(buildSafeShareMessage(i18n.t, "en", null)).toBe(
      "I'm safe after the earthquake. Sent from Bumelerze.",
    );
  });

  it("opens the share sheet, or copies when there is none", async () => {
    const spy = jest
      .spyOn(Share, "share")
      .mockResolvedValueOnce({ action: "sharedAction" });
    await expect(shareSafeMessage("hello")).resolves.toBe("shared");
    expect(spy).toHaveBeenCalledWith({ message: "hello" });
    spy.mockRejectedValueOnce(new Error("no share sheet"));
    await expect(shareSafeMessage("hello")).resolves.toBe("copied");
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });
});
