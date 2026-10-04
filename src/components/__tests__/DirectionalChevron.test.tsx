import { cleanup, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

jest.mock("@expo/vector-icons", () => {
  const { createElement } = jest.requireActual("react");
  const { Text } = jest.requireActual("react-native");
  return {
    Ionicons: ({ name, testID }: { name: string; testID?: string }) =>
      createElement(Text, { testID }, name),
  };
});

// eslint-disable-next-line import/first -- after the mock
import { DirectionalChevron } from "../DirectionalChevron";

describe("DirectionalChevron", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it.each([
    ["en", "chevron-forward"],
    ["kmr", "chevron-forward"],
    ["ckb", "chevron-back"],
    ["ar", "chevron-back"],
  ])("%s points %s", async (locale, glyph) => {
    await i18n.changeLanguage(locale);
    await render(<DirectionalChevron />);
    expect(screen.getByTestId("directional-chevron").props.children).toBe(glyph);
  });
});
