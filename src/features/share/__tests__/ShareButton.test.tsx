import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

import { URMIA_EVENT } from "../__fixtures__/events";
import { ShareButton } from "../ShareButton";

jest.mock("../ShareSheet", () => ({
  ShareSheet: ({ shareId, onClose }: { shareId: string; onClose: () => void }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable testID="fake-sheet" onPress={onClose}>
        <Text>{shareId}</Text>
      </Pressable>
    );
  },
}));

describe("ShareButton", () => {
  afterEach(cleanup);

  it("is a labelled button that opens the sheet for the shared id, and closes it again", async () => {
    await i18n.changeLanguage("en");
    await render(<ShareButton event={URMIA_EVENT} shareId="bml202602ia" />);
    const button = screen.getByTestId("share-button");
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe("Share this earthquake");
    // Nothing is loaded until it is opened.
    expect(screen.queryByTestId("fake-sheet")).toBeNull();
    await fireEvent.press(button);
    expect(screen.getByText("bml202602ia")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("fake-sheet"));
    expect(screen.queryByTestId("fake-sheet")).toBeNull();
  });
});
