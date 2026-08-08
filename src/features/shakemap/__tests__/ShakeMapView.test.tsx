import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { SHAKEMAP_CITY_DOT_RADIUS, SHAKEMAP_LABEL_FONT_SIZE } from "../config";
import halabjaContours from "../__fixtures__/us2000bmcg/cont_mi.trimmed.json";
import { parseIntensityContours } from "../contours";
import { ShakeMapView } from "../components/ShakeMapView";

// Real Halabja epicenter (fixture README) — inside the fixture contours'
// own extent, exercising the ordinary case.
const HALABJA_EPICENTER = { lat: 34.9109, lon: 45.9592 };
const CONTOUR_TEST_ID_PATTERN = /^shakemap-contour-/;
const BASEMAP_BORDER_TEST_ID_PATTERN = /^shakemap-basemap-border-/;
const CITY_DOT_TEST_ID_PATTERN = /^shakemap-city-dot-/;
const CITY_LABEL_TEST_ID_PATTERN = /^shakemap-label-/;

async function measureContainer() {
  const container = screen.getByTestId("shakemap-map-container");
  await fireEvent(container, "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 240 } },
  });
}

describe("ShakeMapView", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    // Unmount before reverting the language — otherwise the still-mounted
    // tree from the "renders the localized MMI caption" test re-renders
    // outside of an awaited `act()` (a harmless but noisy React warning).
    cleanup();
    if (i18n.language !== originalLanguage) {
      await i18n.changeLanguage(originalLanguage);
    }
  });

  it("renders one Polygon per contour ring from the real (trimmed) fixture, once measured", async () => {
    const contours = parseIntensityContours(halabjaContours);
    const totalRings = contours.levels.reduce(
      (sum, level) => sum + level.rings.length,
      0,
    );

    await render(
      <ShakeMapView
        contours={contours}
        epicenter={HALABJA_EPICENTER}
        locale="en"
        t={i18n.t}
        placeText="12 km SE of Halabja, Kurdistan Region"
      />,
    );
    await measureContainer();

    expect(totalRings).toBeGreaterThan(0);
    expect(screen.getAllByTestId(CONTOUR_TEST_ID_PATTERN)).toHaveLength(totalRings);
  });

  it("renders no contour polygons before the container has been measured (width still 0)", async () => {
    const contours = parseIntensityContours(halabjaContours);
    await render(
      <ShakeMapView
        contours={contours}
        epicenter={HALABJA_EPICENTER}
        locale="en"
        t={i18n.t}
        placeText="12 km SE of Halabja, Kurdistan Region"
      />,
    );

    expect(screen.queryAllByTestId(CONTOUR_TEST_ID_PATTERN)).toHaveLength(0);
  });

  it("renders the fixed I..XII legend strip regardless of how many levels the product has", async () => {
    const contours = parseIntensityContours(halabjaContours);
    await render(
      <ShakeMapView
        contours={contours}
        epicenter={HALABJA_EPICENTER}
        locale="en"
        t={i18n.t}
        placeText="12 km SE of Halabja, Kurdistan Region"
      />,
    );

    expect(screen.getByText("I", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText("XII", { includeHiddenElements: true })).toBeTruthy();
  });

  it("renders the localized MMI caption via the i18n catalog, not a hardcoded string", async () => {
    await i18n.changeLanguage("ckb");
    const contours = parseIntensityContours(halabjaContours);
    await render(
      <ShakeMapView
        contours={contours}
        epicenter={HALABJA_EPICENTER}
        locale="ckb"
        t={i18n.t}
        placeText="١٢ کم باشووری ڕۆژهەڵاتی هەڵەبجە"
      />,
    );

    expect(screen.getByText(i18n.t("eventDetail.shakemap.legendCaption"))).toBeTruthy();
  });

  it("folds the place line into the map's accessibilityLabel, not just the max-intensity numeral (accessibility-tester Phase 5: a blind user's only 'where' context for this map)", async () => {
    const contours = parseIntensityContours(halabjaContours);
    await render(
      <ShakeMapView
        contours={contours}
        epicenter={HALABJA_EPICENTER}
        locale="en"
        t={i18n.t}
        placeText="12 km SE of Halabja, Kurdistan Region"
      />,
    );

    const map = screen.getByTestId("shakemap-map-container");
    expect(map.props.accessibilityLabel).toContain("12 km SE of Halabja, Kurdistan Region");
    expect(map.props.accessibilityLabel).toMatch(/maximum intensity/i);
  });

  it("handles an empty contour set without crashing (defensive — callers should never pass this)", async () => {
    await render(
      <ShakeMapView
        contours={{ levels: [], skippedCount: 0 }}
        epicenter={HALABJA_EPICENTER}
        locale="en"
        t={i18n.t}
        placeText="12 km SE of Halabja, Kurdistan Region"
      />,
    );
    await measureContainer();

    expect(screen.queryAllByTestId(CONTOUR_TEST_ID_PATTERN)).toHaveLength(0);
  });

  it("renders basemap border lines under the contours, clipped to this event's own bbox (map-presentation wave)", async () => {
    const contours = parseIntensityContours(halabjaContours);
    await render(
      <ShakeMapView
        contours={contours}
        epicenter={HALABJA_EPICENTER}
        locale="en"
        t={i18n.t}
        placeText="12 km SE of Halabja, Kurdistan Region"
      />,
    );
    await measureContainer();

    // Halabja sits right on the Iran-Iraq border, so at least one border
    // line piece must survive the clip to the (small) contour bbox — a
    // regression here means the basemap fixture stopped being wired up at
    // all, not just an empty-in-this-particular-bbox edge case.
    const borders = screen.getAllByTestId(BASEMAP_BORDER_TEST_ID_PATTERN);
    expect(borders.length).toBeGreaterThan(0);
    for (const border of borders) {
      // `react-native-svg` compiles the `points` prop it's given down to an
      // SVG path `d` string internally — asserting on that compiled output
      // (rather than the original `points` prop, which isn't preserved on
      // the rendered element) is what actually proves real geometry made it
      // all the way to paint.
      expect(typeof border.props.d).toBe("string");
      expect(border.props.d.length).toBeGreaterThan(0);
      // `react-native-svg` compiles `fill="none"` down to a null fill on
      // the rendered element (no fill paint at all) — lines only, no
      // filled shape, matching the toolkit's own boundary-line style.
      expect(border.props.fill).toBeNull();
    }
  });

  it("draws the basemap layer with no fill and a subtle theme border color, never a bold/opaque line", async () => {
    const contours = parseIntensityContours(halabjaContours);
    await render(
      <ShakeMapView
        contours={contours}
        epicenter={HALABJA_EPICENTER}
        locale="en"
        t={i18n.t}
        placeText="12 km SE of Halabja, Kurdistan Region"
      />,
    );
    await measureContainer();

    const borders = screen.getAllByTestId(BASEMAP_BORDER_TEST_ID_PATTERN);
    expect(borders.length).toBeGreaterThan(0);
    for (const border of borders) {
      // Subtle by design (wave brief: keep it minimal like the toolkit's
      // style) — a thin stroke, never the map's own subject.
      expect(border.props.strokeWidth).toBeLessThanOrEqual(1);
      expect(border.props.strokeOpacity).toBeLessThan(1);
    }
  });

  it("draws city dots and labels from theme-token sizes, not hardcoded large values", async () => {
    const contours = parseIntensityContours(halabjaContours);
    await render(
      <ShakeMapView
        contours={contours}
        epicenter={HALABJA_EPICENTER}
        locale="en"
        t={i18n.t}
        placeText="12 km SE of Halabja, Kurdistan Region"
      />,
    );
    await measureContainer();

    const dots = screen.getAllByTestId(CITY_DOT_TEST_ID_PATTERN);
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(dot.props.r).toBe(SHAKEMAP_CITY_DOT_RADIUS);
      // Regression guard against the pre-fix hardcoded radius (2.5) — the
      // owner's "too large" complaint.
      expect(dot.props.r).toBeLessThan(2.5);
    }

    const labels = screen.getAllByTestId(CITY_LABEL_TEST_ID_PATTERN);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      // `react-native-svg` folds `fontSize`/`fontWeight` into a compiled
      // `font` object on the rendered element rather than keeping them as
      // separate props.
      expect(label.props.font.fontSize).toBe(SHAKEMAP_LABEL_FONT_SIZE);
      // Regression guard against the pre-fix hardcoded fontSize (9).
      expect(label.props.font.fontSize).toBeLessThan(9);
    }
  });
});
