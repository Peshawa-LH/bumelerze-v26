/**
 * A comment's paragraphs each read in their own direction and start at
 * their own edge, as on the web (`unicode-bidi: plaintext`): iOS/Android
 * have no such style, so the row gives each paragraph its own `Text`.
 */
import { screen } from "@testing-library/react-native";
import { I18nManager, StyleSheet } from "react-native";

import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import i18n from "@/i18n";

import { CommentRow } from "../components/CommentRow";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  getSupabaseClient: () => null,
}));

const AUTHOR = { name: "Shirin", username: "shirin", avatarPath: null, roles: undefined };

async function renderBody(body: string) {
  await renderWithProviders(
    <CommentRow id="c1" author={AUTHOR} body={body} timeText="3d" />,
  );
  return screen.getByTestId("comment-body-c1");
}

function paragraphStyle(text: string) {
  return StyleSheet.flatten(screen.getByText(text).props.style);
}

describe("CommentRow paragraphs (iOS)", () => {
  const originalIsRTL = I18nManager.isRTL;

  afterEach(async () => {
    I18nManager.isRTL = originalIsRTL;
    await i18n.changeLanguage("en");
  });

  it("[regression] an English line in a Sorani thread reads left to right on the left", async () => {
    await i18n.changeLanguage("ckb");
    I18nManager.isRTL = true;
    await renderBody("The shaking was strong in Erbil");
    // Under a right-to-left layout iOS swaps sides: "right" is drawn on the left.
    expect(paragraphStyle("The shaking was strong in Erbil")).toMatchObject({
      writingDirection: "ltr",
      textAlign: "right",
    });
  });

  it("a Sorani line in the same thread sits at the right", async () => {
    await i18n.changeLanguage("ckb");
    I18nManager.isRTL = true;
    await renderBody("لە هەولێر بە هێز هەستمان پێکرد");
    expect(paragraphStyle("لە هەولێر بە هێز هەستمان پێکرد")).toMatchObject({
      writingDirection: "rtl",
      textAlign: "left",
    });
  });

  it("gives every paragraph of a mixed comment its own direction", async () => {
    await i18n.changeLanguage("en");
    I18nManager.isRTL = false;
    const body = await renderBody("Strong here\n\nلێرە بەهێز بوو\n12 km");
    expect(body).toHaveTextContent(/Strong here/);
    expect(paragraphStyle("Strong here")).toMatchObject({
      writingDirection: "ltr",
      textAlign: "left",
    });
    expect(paragraphStyle("لێرە بەهێز بوو")).toMatchObject({
      writingDirection: "rtl",
      textAlign: "right",
    });
    // Starts with a digit, then a Latin letter: left to right.
    expect(paragraphStyle("12 km")).toMatchObject({ writingDirection: "ltr" });
  });
});
