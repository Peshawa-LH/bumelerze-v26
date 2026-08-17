import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

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
        grade={3}
        label="Large wall cracks"
        accessibilityLabel="Single/low-rise. Large wall cracks"
        locale="en"
        onPress={jest.fn()}
      />,
    );

    expect(
      screen.getByLabelText("Single/low-rise. Large wall cracks"),
    ).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("3 - Large wall cracks")).toBeTruthy();
    expect(screen.queryByTestId("damage-tile-artwork")).toBeNull();
  });

  it("renders an Image alone over the swatch (no numeral overlay) when given an imageSource, moving the grade into the label", async () => {
    await render(
      <DamageTile
        typology="lowrise"
        grade={3}
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
    // No bare "3" text node floating over the artwork anymore...
    expect(screen.queryByText("3")).toBeNull();
    // ...the grade now lives in the label line instead.
    expect(screen.getByText("3 - Large wall cracks")).toBeTruthy();

    // `accessibilityElementsHidden` intentionally hides the image from the
    // accessibility tree (it's decorative — see the component's comment),
    // which also hides it from RNTL's queries by default, so this query
    // opts back in explicitly rather than that being a bug to "fix".
    const image = screen.getByTestId("damage-tile-artwork", {
      includeHiddenElements: true,
    });
    expect(image.props.source).toEqual({ uri: "test" });
  });

  // Damage-tile sizing bug (Wave A, 2026-08-17): a short trailing row used
  // to stretch via `flexGrow: 1`. `width` (from the parent grid's
  // `useTileGridLayout`) replaces that with an exact pixel size shared by
  // every tile — this locks in that once `width` is supplied, the rendered
  // style carries that exact value and no `flexGrow`.
  it("renders at the exact measured width and drops flexGrow when the grid has measured itself", async () => {
    await render(
      <DamageTile
        typology="lowrise"
        grade={3}
        label="Large wall cracks"
        accessibilityLabel="Single/low-rise. Large wall cracks"
        locale="en"
        onPress={jest.fn()}
        width={62.4}
      />,
    );

    const tile = screen.getByLabelText("Single/low-rise. Large wall cracks");
    const flatStyle = StyleSheet.flatten(tile.props.style);
    expect(flatStyle.width).toBe(62.4);
    expect(flatStyle.flexGrow).toBe(0);
    expect(flatStyle.flexBasis).toBeUndefined();
  });

  it("two tiles given the same measured width render at identical sizes regardless of row position", async () => {
    await render(
      <>
        <DamageTile
          typology="lowrise"
          grade={1}
          label="No visible damage"
          accessibilityLabel="Single/low-rise. No visible damage"
          locale="en"
          onPress={jest.fn()}
          width={62.4}
        />
        <DamageTile
          typology="lowrise"
          grade={5}
          label="Partial collapse"
          accessibilityLabel="Single/low-rise. Partial collapse"
          locale="en"
          onPress={jest.fn()}
          width={62.4}
        />
      </>,
    );

    const firstTile = screen.getByLabelText("Single/low-rise. No visible damage");
    const lastTile = screen.getByLabelText("Single/low-rise. Partial collapse");
    expect(StyleSheet.flatten(firstTile.props.style).width).toBe(
      StyleSheet.flatten(lastTile.props.style).width,
    );
  });
});
