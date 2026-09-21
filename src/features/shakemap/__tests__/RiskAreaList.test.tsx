import { fireEvent, render, renderHook, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { useTheme } from "@/theme";
import areasFixture from "../__fixtures__/us2000bmcg/areas.json";
import { RiskAreaList } from "../components/RiskAreaList";
import { parseRiskAreas } from "../risk";
import type { RiskAreas } from "../types";

async function themeArgs() {
  const { result } = await renderHook(() => useTheme());
  return result.current;
}

function realAreas(): RiskAreas {
  const areas = parseRiskAreas(areasFixture);
  if (!areas) {
    throw new Error("fixture areas product failed to parse — fixture is broken");
  }
  return areas;
}

describe("RiskAreaList", () => {
  it("defaults to the city level (non-empty) and shows the areas title", async () => {
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskAreaList
        areas={realAreas()}
        locale="en"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(screen.getByText(i18n.t("eventDetail.risk.areasTitle"))).toBeTruthy();
    // Fixture city rows: "Sulaymaniyah" (worst-first) then "Chamchamal".
    expect(screen.getByText("Sulaymaniyah")).toBeTruthy();
    expect(screen.getByText("Chamchamal")).toBeTruthy();
    const cityTab = screen.getByTestId("risk-area-level-city");
    expect(cityTab.props.accessibilityState).toEqual({ selected: true });
  });

  it("renders one tab per non-empty level, in the switch order", async () => {
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskAreaList
        areas={realAreas()}
        locale="en"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(screen.getByTestId("risk-area-level-city")).toBeTruthy();
    expect(screen.getByTestId("risk-area-level-subdistrict")).toBeTruthy();
    expect(screen.getByTestId("risk-area-level-district")).toBeTruthy();
    expect(screen.getByTestId("risk-area-level-governorate")).toBeTruthy();
  });

  it("switches the rendered rows when a different level tab is pressed", async () => {
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskAreaList
        areas={realAreas()}
        locale="en"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    // Starts on "city" (Sulaymaniyah/Chamchamal); switch to "governorate"
    // (Al-Sulaymaniyah/Erbil) and the city-level names disappear.
    await fireEvent.press(screen.getByTestId("risk-area-level-governorate"));

    expect(screen.getByText("Al-Sulaymaniyah")).toBeTruthy();
    expect(screen.getByText("Erbil")).toBeTruthy();
    expect(screen.queryByText("Chamchamal")).toBeNull();
    expect(screen.getByTestId("risk-area-level-governorate").props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId("risk-area-level-city").props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it("hides levels with no rows from the switch", async () => {
    const areas = realAreas();
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskAreaList
        areas={{ ...areas, levels: { ...areas.levels, subdistrict: [] } }}
        locale="en"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(screen.queryByTestId("risk-area-level-subdistrict")).toBeNull();
    expect(screen.getByTestId("risk-area-level-city")).toBeTruthy();
  });

  it("shows the first 6 rows with a 'Show all' toggle, then reveals every row on tap", async () => {
    const areas = realAreas();
    const extraCity = { ...areas.levels.city[1]!, id: "99999", name: "Extra City" };
    // Pad the city level to 7 rows so the "Show all" cutoff (6) applies.
    const paddedCities = [
      ...areas.levels.city,
      ...Array.from({ length: 5 }, (_, i) => ({ ...extraCity, id: `9999${i}`, name: `Extra City ${i}` })),
    ];
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskAreaList
        areas={{ ...areas, levels: { ...areas.levels, city: paddedCities } }}
        locale="en"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(screen.getAllByTestId("risk-area-row")).toHaveLength(6);
    expect(screen.queryByText("Extra City 4")).toBeNull();
    expect(
      screen.getByText(i18n.t("eventDetail.risk.showAll", { count: String(paddedCities.length) })),
    ).toBeTruthy();

    await fireEvent.press(screen.getByTestId("risk-areas-show-all"));

    expect(screen.getAllByTestId("risk-area-row")).toHaveLength(paddedCities.length);
    expect(screen.getByText("Extra City 4")).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.risk.showFewer"))).toBeTruthy();
  });

  it("resets 'Show all' back to the first 6 rows when the level switches", async () => {
    const areas = realAreas();
    const extraCity = { ...areas.levels.city[1]!, id: "99999", name: "Extra City" };
    const paddedCities = [
      ...areas.levels.city,
      ...Array.from({ length: 5 }, (_, i) => ({ ...extraCity, id: `9999${i}`, name: `Extra City ${i}` })),
    ];
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskAreaList
        areas={{ ...areas, levels: { ...areas.levels, city: paddedCities } }}
        locale="en"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    await fireEvent.press(screen.getByTestId("risk-areas-show-all"));
    expect(screen.getByText(i18n.t("eventDetail.risk.showFewer"))).toBeTruthy();

    await fireEvent.press(screen.getByTestId("risk-area-level-governorate"));

    // Governorate only has 2 rows, so there is nothing left to page, but
    // switching back to "city" must show the collapsed first-6 state again.
    await fireEvent.press(screen.getByTestId("risk-area-level-city"));
    expect(
      screen.getByText(i18n.t("eventDetail.risk.showAll", { count: String(paddedCities.length) })),
    ).toBeTruthy();
  });

  it("returns nothing when every level is empty", async () => {
    const areas = realAreas();
    const { colors, typography, spacing } = await themeArgs();
    const { toJSON } = await render(
      <RiskAreaList
        areas={{
          ...areas,
          levels: { governorate: [], district: [], subdistrict: [], city: [] },
        }}
        locale="en"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(toJSON()).toBeNull();
  });

  it("hides the level switch entirely when only one level has rows", async () => {
    const areas = realAreas();
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskAreaList
        areas={{
          ...areas,
          levels: { governorate: [], district: [], subdistrict: [], city: areas.levels.city },
        }}
        locale="en"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(screen.queryByTestId("risk-area-level-city")).toBeNull();
    expect(screen.getByText("Sulaymaniyah")).toBeTruthy();
  });

  it("defaults to the district level when the city list is empty", async () => {
    const areas = realAreas();
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskAreaList
        areas={{ ...areas, levels: { ...areas.levels, city: [] } }}
        locale="en"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(screen.getByTestId("risk-area-level-district").props.accessibilityState).toEqual({
      selected: true,
    });
    // Fixture district rows: "Sulaymaniyah" then "Chamchamal".
    expect(screen.getByText("Sulaymaniyah")).toBeTruthy();
  });

  it("tags a low-coverage area as 'partly inside map' and gives each row an accessible label", async () => {
    const areas = realAreas();
    const lowCoverageCity = { ...areas.levels.city[0]!, coverage: 0.2 };
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskAreaList
        areas={{ ...areas, levels: { ...areas.levels, city: [lowCoverageCity, areas.levels.city[1]!] } }}
        locale="en"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(screen.getByText(i18n.t("eventDetail.risk.partlyInsideMap"))).toBeTruthy();
    const rows = screen.getAllByTestId("risk-area-row");
    expect(rows[0]?.props.accessibilityLabel).toContain("Sulaymaniyah");
  });
});

describe("place names (2026-09-21)", () => {
  /** The fixture's areas with one governorate row swapped for a named one. */
  function withNamedGovernorate(names: Record<string, string> | null): RiskAreas {
    const base = realAreas();
    const row = base.levels.governorate[0] ?? base.levels.city[0]!;
    return {
      ...base,
      levels: {
        ...base.levels,
        city: [],
        subdistrict: [],
        district: [],
        governorate: [{ ...row, name: "Slemani", names }],
      },
    };
  }

  it("shows a Kurdish area under its Kurdish name, not the boundary file's transliteration", async () => {
    // OCHA COD-AB calls Slemani "Al-Sulaymaniyah". The producer corrects
    // that and ships the Sorani and Kurmanji forms alongside it.
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskAreaList
        areas={withNamedGovernorate({ en: "Slemani", ckb: "سلێمانی", kmr: "Silêmanî", ar: "السليمانية" })}
        locale="ckb"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(screen.getByText("سلێمانی")).toBeTruthy();
    expect(screen.queryByText("Slemani")).toBeNull();
  });

  it("falls back to the English name for a locale the producer has no form for", async () => {
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskAreaList
        areas={withNamedGovernorate(null)}
        locale="ckb"
        t={i18n.t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(screen.getByText("Slemani")).toBeTruthy();
  });
});
