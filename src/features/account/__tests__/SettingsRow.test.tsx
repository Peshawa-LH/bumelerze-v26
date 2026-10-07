import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Platform, StyleSheet } from "react-native";

import { SettingsRow } from "../components/SettingsRow";
import { setLastInteractionWasKeyboard } from "../components/use-focus-visible";

describe("SettingsRow", () => {
  it("shows the value beside the label by default", async () => {
    await render(
      <SettingsRow icon="language-outline" label="Language" value="English" />,
    );
    expect(screen.getByText("Language")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.getByLabelText("Language, English")).toBeTruthy();
  });

  it("stacks a long value under the label and still speaks both", async () => {
    await render(
      <SettingsRow
        icon="location-outline"
        label="My location"
        value="Duhok · Location off"
        valueLayout="stacked"
        trailing="expand"
      />,
    );
    const label = screen.getByText("My location");
    const value = screen.getByText("Duhok · Location off");
    // Same column: the value's parent is the label's parent.
    expect(value.parent?.parent).toBe(label.parent?.parent);
    expect(screen.getByLabelText("My location, Duhok · Location off")).toBeTruthy();
  });

  describe("focus ring on web", () => {
    const originalOS = Platform.OS;
    beforeEach(() => {
      Platform.OS = "web";
    });
    afterEach(() => {
      Platform.OS = originalOS;
      setLastInteractionWasKeyboard(false);
    });

    function outlineWidthOf(testID: string) {
      const style = StyleSheet.flatten(screen.getByTestId(testID).props.style);
      return (style as { outlineWidth?: number }).outlineWidth;
    }

    it("draws no ring when focus came from a tap or click", async () => {
      setLastInteractionWasKeyboard(false);
      await render(<SettingsRow icon="language-outline" label="Language" testID="row" />);
      await act(async () => {
        fireEvent(screen.getByTestId("row"), "focus");
      });
      expect(outlineWidthOf("row")).toBeUndefined();
    });

    it("draws the ring for keyboard focus and removes it on blur", async () => {
      setLastInteractionWasKeyboard(true);
      await render(<SettingsRow icon="language-outline" label="Language" testID="row" />);
      await act(async () => {
        fireEvent(screen.getByTestId("row"), "focus");
      });
      expect(outlineWidthOf("row")).toBe(2);
      await act(async () => {
        fireEvent(screen.getByTestId("row"), "blur");
      });
      expect(outlineWidthOf("row")).toBeUndefined();
    });
  });
});
