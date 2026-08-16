import { render, screen } from "@testing-library/react-native";

import { DamageTile } from "../components/DamageTile";

/**
 * tile-image-rendering wave: mirrors `LevelTile.test.tsx` for `DamageTile`'s
 * `imageSource` prop — renders unchanged (bare numeral on the swatch) when
 * absent, renders an `expo-image` `<Image>` alone over the swatch when
 * given a plain `{ uri }` source (no numeral overlay — owner directive
 * 2026-08-16, same "N - Label" move as `LevelTile`, kept consistent across
 * windows 1 and 2).
 */
describe("DamageTile", () => {
  it("renders the plain color swatch (no image) with a bare numeral and a plain label when imageSource is absent", async () => {
    await render(
      <DamageTile
        typology="lowrise"
        grade={2}
        label="Large wall cracks"
        accessibilityLabel="Single/low-rise. Large wall cracks"
        locale="en"
        onPress={jest.fn()}
      />,
    );

    expect(
      screen.getByLabelText("Single/low-rise. Large wall cracks"),
    ).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("2 - Large wall cracks")).toBeTruthy();
    expect(screen.queryByTestId("damage-tile-artwork")).toBeNull();
  });

  it("renders an Image alone over the swatch (no numeral overlay) when given an imageSource, moving the grade into the label", async () => {
    await render(
      <DamageTile
        typology="lowrise"
        grade={2}
        label="Large wall cracks"
        accessibilityLabel="Single/low-rise. Large wall cracks"
        locale="en"
        onPress={jest.fn()}
        imageSource={{ uri: "test" }}
      />,
    );

    expect(
      screen.getByLabelText("Single/low-rise. Large wall cracks"),
    ).toBeTruthy();
    // No bare "2" text node floating over the artwork anymore...
    expect(screen.queryByText("2")).toBeNull();
    // ...the grade now lives in the label line instead.
    expect(screen.getByText("2 - Large wall cracks")).toBeTruthy();

    // `accessibilityElementsHidden` intentionally hides the image from the
    // accessibility tree (it's decorative — see the component's comment),
    // which also hides it from RNTL's queries by default, so this query
    // opts back in explicitly rather than that being a bug to "fix".
    const image = screen.getByTestId("damage-tile-artwork", {
      includeHiddenElements: true,
    });
    expect(image.props.source).toEqual({ uri: "test" });
  });
});
