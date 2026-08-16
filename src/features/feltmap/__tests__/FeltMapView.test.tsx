import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { processColor } from "react-native";

import i18n from "@/i18n";
import { mmiValueToLevel } from "@/features/shakemap";
import { lightColors } from "@/theme/semantic";
import {
  CHAMCHAMAL_CENTER,
  CHAMCHAMAL_FELT_MAP_FIXTURE,
} from "../__fixtures__/chamchamal";
import { selectFeltMapCells } from "../cell-selection";
import { FeltMapView } from "../components/FeltMapView";

const CELL_TEST_ID_PATTERN = /^feltmap-cell-/;

async function measureContainer() {
  const container = screen.getByTestId("feltmap-map-container");
  await fireEvent(container, "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 240 } },
  });
}

describe("FeltMapView (golden: Chamchamal fixture)", () => {
  const originalLanguage = i18n.language;
  const cells = selectFeltMapCells(CHAMCHAMAL_FELT_MAP_FIXTURE);

  afterEach(async () => {
    cleanup();
    if (i18n.language !== originalLanguage) {
      await i18n.changeLanguage(originalLanguage);
    }
  });

  it("keeps every fixture cell after selection (all p5, all non-null cdi, no nesting)", () => {
    expect(cells).toHaveLength(CHAMCHAMAL_FELT_MAP_FIXTURE.length);
  });

  it("renders exactly one cell rect per fixture cell, once measured", async () => {
    await render(
      <FeltMapView
        cells={cells}
        epicenter={CHAMCHAMAL_CENTER}
        locale="en"
        t={i18n.t}
        placeText="Chamchamal, Kurdistan Region"
      />,
    );
    await measureContainer();

    expect(screen.getAllByTestId(CELL_TEST_ID_PATTERN)).toHaveLength(cells.length);
  });

  it("renders no cell rects before the container has been measured (width still 0)", async () => {
    await render(
      <FeltMapView
        cells={cells}
        epicenter={CHAMCHAMAL_CENTER}
        locale="en"
        t={i18n.t}
        placeText="Chamchamal, Kurdistan Region"
      />,
    );

    expect(screen.queryAllByTestId(CELL_TEST_ID_PATTERN)).toHaveLength(0);
  });

  it("colors each cell from the theme intensity ramp at its CDI's rounded level — never a hardcoded hex", async () => {
    await render(
      <FeltMapView
        cells={cells}
        epicenter={CHAMCHAMAL_CENTER}
        locale="en"
        t={i18n.t}
        placeText="Chamchamal, Kurdistan Region"
      />,
    );
    await measureContainer();

    for (const cell of cells) {
      const rect = screen.getByTestId(`feltmap-cell-${cell.geohash}`);
      const expectedLevel = mmiValueToLevel(cell.cdi as number);
      // `react-native-svg` compiles a `fill` hex string down to a processed
      // color object (`{ type, payload }`) on the rendered element rather
      // than preserving the original string — compare through the same
      // `processColor` compilation step instead of the raw hex.
      expect(rect.props.fill.payload).toEqual(
        processColor(lightColors.intensity[expectedLevel]),
      );
    }
  });

  it("draws the highest-CDI (center) cell with real, finite, non-negative geometry", async () => {
    await render(
      <FeltMapView
        cells={cells}
        epicenter={CHAMCHAMAL_CENTER}
        locale="en"
        t={i18n.t}
        placeText="Chamchamal, Kurdistan Region"
      />,
    );
    await measureContainer();

    const centerCell = cells.find((c) => c.cdi === 6.0);
    expect(centerCell).toBeDefined();
    const rect = screen.getByTestId(`feltmap-cell-${centerCell?.geohash}`);
    expect(Number.isFinite(rect.props.x)).toBe(true);
    expect(Number.isFinite(rect.props.y)).toBe(true);
    expect(rect.props.width).toBeGreaterThan(0);
    expect(rect.props.height).toBeGreaterThan(0);
  });

  it("renders the fixed 2-9 CDI legend strip, digit-localized", async () => {
    await render(
      <FeltMapView
        cells={cells}
        epicenter={CHAMCHAMAL_CENTER}
        locale="en"
        t={i18n.t}
        placeText="Chamchamal, Kurdistan Region"
      />,
    );

    for (const level of [2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(screen.getByText(String(level), { includeHiddenElements: true })).toBeTruthy();
    }
  });

  it("renders the CDI legend digits in Eastern Arabic-Indic glyphs under ckb", async () => {
    await i18n.changeLanguage("ckb");
    await render(
      <FeltMapView
        cells={cells}
        epicenter={CHAMCHAMAL_CENTER}
        locale="ckb"
        t={i18n.t}
        placeText="چەمچەماڵ"
      />,
    );

    // CDI level 9's localized digit (Eastern Arabic-Indic).
    expect(screen.getByText("٩", { includeHiddenElements: true })).toBeTruthy();
  });

  it("renders the localized legend caption and report-count line via the i18n catalog", async () => {
    await render(
      <FeltMapView
        cells={cells}
        epicenter={CHAMCHAMAL_CENTER}
        locale="en"
        t={i18n.t}
        placeText="Chamchamal, Kurdistan Region"
      />,
    );

    expect(screen.getByText(i18n.t("eventDetail.feltMap.legendCaption"))).toBeTruthy();

    const totalReports = cells.reduce((sum, cell) => sum + cell.n_reports, 0);
    expect(
      screen.getByText(
        i18n.t("eventDetail.feltMap.reportCount", {
          count: String(totalReports),
          cells: String(cells.length),
        }),
      ),
    ).toBeTruthy();
  });

  it("folds the total report count and place line into the map's accessibilityLabel", async () => {
    await render(
      <FeltMapView
        cells={cells}
        epicenter={CHAMCHAMAL_CENTER}
        locale="en"
        t={i18n.t}
        placeText="Chamchamal, Kurdistan Region"
      />,
    );

    const map = screen.getByTestId("feltmap-map-container");
    const totalReports = cells.reduce((sum, cell) => sum + cell.n_reports, 0);
    expect(map.props.accessibilityLabel).toContain(String(totalReports));
    expect(map.props.accessibilityLabel).toContain("Chamchamal, Kurdistan Region");
  });
});
