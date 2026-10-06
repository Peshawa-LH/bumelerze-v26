import { render, screen } from "@testing-library/react-native";

import { SettingsRow } from "../components/SettingsRow";

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
});
