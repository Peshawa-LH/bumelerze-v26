import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import halabjaContours from "../__fixtures__/us2000bmcg/cont_mi.trimmed.json";
import { parseIntensityContours } from "../contours";
import { ShakeMapView } from "../components/ShakeMapView";

// Real Halabja epicenter (fixture README) — inside the fixture contours'
// own extent, exercising the ordinary case.
const HALABJA_EPICENTER = { lat: 34.9109, lon: 45.9592 };
const CONTOUR_TEST_ID_PATTERN = /^shakemap-contour-/;

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
      />,
    );

    expect(screen.getByText(i18n.t("eventDetail.shakemap.legendCaption"))).toBeTruthy();
  });

  it("handles an empty contour set without crashing (defensive — callers should never pass this)", async () => {
    await render(
      <ShakeMapView
        contours={{ levels: [], skippedCount: 0 }}
        epicenter={HALABJA_EPICENTER}
        locale="en"
        t={i18n.t}
      />,
    );
    await measureContainer();

    expect(screen.queryAllByTestId(CONTOUR_TEST_ID_PATTERN)).toHaveLength(0);
  });
});
