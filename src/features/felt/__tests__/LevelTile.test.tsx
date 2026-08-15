import { cleanup, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { LevelTile } from "../components/LevelTile";

/**
 * tile-image-rendering wave: `LevelTile` now renders an `expo-image` `<Image>`
 * over its color swatch when handed an `imageSource`, and renders exactly as
 * before (swatch + numeral + label, no image) when the prop is absent — no
 * real artwork exists yet (`cartoon-artwork-brief.md` §5), so these tests use
 * a plain `{ uri: "test" }` source, never a `require()`d asset.
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

  it("renders the plain color swatch (no image) when imageSource is absent", async () => {
    await render(
      <LevelTile level={3} label="Weak shaking" locale="en" onPress={jest.fn()} />,
    );

    expect(screen.getByLabelText("3. Weak shaking")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("Weak shaking")).toBeTruthy();
    expect(screen.queryByTestId("level-tile-artwork")).toBeNull();
  });

  it("renders an Image over the swatch when given an imageSource", async () => {
    await render(
      <LevelTile
        level={3}
        label="Weak shaking"
        locale="en"
        onPress={jest.fn()}
        imageSource={{ uri: "test" }}
      />,
    );

    // The tile still exposes the same numeral/label content and
    // accessibility label — the artwork is decorative, not a replacement.
    expect(screen.getByLabelText("3. Weak shaking")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();

    // `accessibilityElementsHidden` intentionally hides the image from the
    // accessibility tree (it's decorative — see the component's comment),
    // which also hides it from RNTL's queries by default, so this query
    // opts back in explicitly rather than that being a bug to "fix".
    const image = screen.getByTestId("level-tile-artwork", {
      includeHiddenElements: true,
    });
    expect(image.props.source).toEqual({ uri: "test" });
  });
});
