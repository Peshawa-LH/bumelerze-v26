import { cleanup, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import i18n from "@/i18n";
import { LevelTile } from "../components/LevelTile";

/**
 * tile-image-rendering wave: `LevelTile` renders an `expo-image` `<Image>`
 * over its color swatch when handed an `imageSource`, and renders exactly as
 * before (swatch + numeral) when the prop is absent. These tests use a
 * plain `{ uri: "test" }` source, never a `require()`d asset (that mapping
 * is regression-locked separately in `artwork.test.ts`).
 *
 * Owner directive 2026-08-16 (live feedback on the real art): the numeral
 * no longer overlays the artwork at all — once real art fills the swatch,
 * the numeral moves into the label line as "N - Label" (`felt.numberedLabel`)
 * instead. The bare-numeral-on-swatch rendering survives ONLY as the
 * no-artwork fallback (still covers any future tile without art).
 */
describe("LevelTile", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    // Unmount before switching the language back — RNTL's own auto-registered
    // `afterEach(cleanup)` (from its module import) runs in the *outer* scope,
    // which fires AFTER this describe's afterEach hooks, so without an
    // explicit `cleanup()` here first, `changeLanguage` triggers a re-render
    // on a still-mounted tree outside of `act()` (found the hard way, mirrors
    // `CatalogFilterBar.test.tsx`'s note on the same auto-cleanup ordering).
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders the plain color swatch (no image) with a bare numeral and a plain label when imageSource is absent", async () => {
    await render(
      <LevelTile level={3} label="Weak shaking" locale="en" onPress={jest.fn()} />,
    );

    expect(screen.getByLabelText("3. Weak shaking")).toBeTruthy();
    // Fallback path only: the numeral still sits directly on the swatch...
    expect(screen.getByText("3")).toBeTruthy();
    // ...and the label line below is still "N - Label" (owner directive:
    // the number always lives in the label now, image or no image).
    expect(screen.getByText("3 - Weak shaking")).toBeTruthy();
    expect(screen.queryByTestId("level-tile-artwork")).toBeNull();
  });

  it("renders an Image alone over the swatch (no numeral overlay) when given an imageSource, moving the number into the label", async () => {
    await render(
      <LevelTile
        level={3}
        label="Weak shaking"
        locale="en"
        onPress={jest.fn()}
        imageSource={{ uri: "test" }}
      />,
    );

    // Accessibility label is unchanged — screen readers still get number +
    // level name regardless of the visual overlay decision.
    expect(screen.getByLabelText("3. Weak shaking")).toBeTruthy();

    // No bare "3" text node floating over the artwork anymore...
    expect(screen.queryByText("3")).toBeNull();
    // ...the number now lives in the label line instead.
    expect(screen.getByText("3 - Weak shaking")).toBeTruthy();

    // `accessibilityElementsHidden` intentionally hides the image from the
    // accessibility tree (it's decorative — see the component's comment),
    // which also hides it from RNTL's queries by default, so this query
    // opts back in explicitly rather than that being a bug to "fix".
    const image = screen.getByTestId("level-tile-artwork", {
      includeHiddenElements: true,
    });
    expect(image.props.source).toEqual({ uri: "test" });
  });

  it("localizes the digit in the numbered label for Sorani (Eastern Arabic-Indic)", async () => {
    await i18n.changeLanguage("ckb");
    await render(
      <LevelTile level={3} label="لەرزینی لاواز" locale="ckb" onPress={jest.fn()} />,
    );

    expect(screen.getByText("٣ - لەرزینی لاواز")).toBeTruthy();
  });

  // Damage/level-tile sizing bug (Wave A, 2026-08-17): a short trailing row
  // used to stretch via `flexGrow: 1` (masked here only because the 1-9/
  // 10-12 split happens to divide evenly by 3 — see `grid-layout.ts`).
  // `width` (from `useTileGridLayout`) replaces percentage sizing with an
  // exact pixel size shared by every tile, `compact` or not.
  it("renders at the exact measured width and drops flexGrow/flexBasis when the grid has measured itself, compact or not", async () => {
    await render(
      <>
        <LevelTile level={3} label="Weak shaking" locale="en" onPress={jest.fn()} width={112} />
        <LevelTile
          level={11}
          label="Total collapse"
          locale="en"
          onPress={jest.fn()}
          compact
          width={112}
        />
      </>,
    );

    for (const label of ["3. Weak shaking", "11. Total collapse"]) {
      const flatStyle = StyleSheet.flatten(screen.getByLabelText(label).props.style);
      expect(flatStyle.width).toBe(112);
      expect(flatStyle.flexGrow).toBe(0);
      expect(flatStyle.flexBasis).toBeUndefined();
    }
  });
});
