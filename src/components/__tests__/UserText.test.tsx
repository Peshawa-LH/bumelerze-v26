/**
 * Text a person wrote reads per paragraph in its own direction on iOS, as a
 * browser lays it out (the web keeps its one element).
 */
import { render, screen } from "@testing-library/react-native";
import { I18nManager, Platform, StyleSheet } from "react-native";

import { UserText } from "../UserText";

const STYLE = { fontSize: 16, lineHeight: 24, textAlign: "auto" as const };

function paragraphStyle(text: string) {
  return StyleSheet.flatten(screen.getByText(text).props.style);
}

describe("UserText (iOS)", () => {
  const originalIsRTL = I18nManager.isRTL;
  afterEach(() => {
    I18nManager.isRTL = originalIsRTL;
  });

  it("[regression] an English bio in the Sorani app reads left to right on the left", async () => {
    I18nManager.isRTL = true;
    await render(
      <UserText text="Engineer in Erbil" locale="ckb" style={STYLE} testID="bio" />,
    );
    // Under a right-to-left layout iOS swaps sides: "right" is drawn on the left.
    expect(paragraphStyle("Engineer in Erbil")).toMatchObject({
      writingDirection: "ltr",
      textAlign: "right",
    });
  });

  it("gives every paragraph its own direction and keeps empty lines", async () => {
    I18nManager.isRTL = false;
    await render(
      <UserText
        text={"Strong here\n\nلێرە بەهێز بوو"}
        locale="en"
        style={STYLE}
        testID="post"
      />,
    );
    expect(paragraphStyle("Strong here")).toMatchObject({
      writingDirection: "ltr",
      textAlign: "left",
    });
    expect(paragraphStyle("لێرە بەهێز بوو")).toMatchObject({
      writingDirection: "rtl",
      textAlign: "right",
    });
    expect(screen.getByTestId("post")).toBeTruthy();
  });

  it("uses the app language for a paragraph without letters", async () => {
    I18nManager.isRTL = true;
    await render(<UserText text="١٢ · 45%" locale="ar" style={STYLE} />);
    expect(paragraphStyle("١٢ · 45%")).toMatchObject({
      writingDirection: "rtl",
      textAlign: "left",
    });
  });

  it("keeps a capped text in one Text with the direction of its first letter", async () => {
    I18nManager.isRTL = false;
    await render(
      <UserText
        text={"هەولێر\nErbil"}
        locale="en"
        style={STYLE}
        numberOfLines={2}
        testID="place"
      />,
    );
    expect(screen.getByTestId("place").props.numberOfLines).toBe(2);
    expect(StyleSheet.flatten(screen.getByTestId("place").props.style)).toMatchObject({
      writingDirection: "rtl",
    });
  });
});

describe("UserText (web)", () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it("keeps the one element and the style it was given", async () => {
    Platform.OS = "web";
    await render(
      <UserText text={"Hello\nسڵاو"} locale="ckb" style={STYLE} testID="bio" />,
    );
    expect(StyleSheet.flatten(screen.getByTestId("bio").props.style)).toEqual(STYLE);
  });
});
