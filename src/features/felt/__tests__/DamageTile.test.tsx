import { render, screen } from "@testing-library/react-native";

import { DamageTile } from "../components/DamageTile";

/**
 * tile-image-rendering wave: mirrors `LevelTile.test.tsx` for `DamageTile`'s
 * `imageSource` prop — renders unchanged (no image) when absent, renders an
 * `expo-image` `<Image>` over the swatch when given a plain `{ uri }` source
 * (no real artwork PNGs exist yet, `cartoon-artwork-brief.md` §6.5).
 */
describe("DamageTile", () => {
  it("renders the plain color swatch (no image) when imageSource is absent", async () => {
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
    expect(screen.getByText("Large wall cracks")).toBeTruthy();
    expect(screen.queryByTestId("damage-tile-artwork")).toBeNull();
  });

  it("renders an Image over the swatch when given an imageSource", async () => {
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
    expect(screen.getByText("2")).toBeTruthy();

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
