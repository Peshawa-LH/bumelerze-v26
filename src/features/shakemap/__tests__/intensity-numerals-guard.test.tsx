import { cleanup, render, renderHook, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { useTheme } from "@/theme";

import halabjaContours from "../__fixtures__/us2000bmcg/cont_mi.trimmed.json";
import {
  collectLabels,
  collectText,
  ROMAN_NUMERAL,
} from "../__fixtures__/roman-numerals";
import { RiskShakingLevels } from "../components/RiskShakingLevels";
import { ShakeMapLegend } from "../components/ShakeMapLegend";
import { ShakeMapView } from "../components/ShakeMapView";
import { parseIntensityContours } from "../contours";

/**
 * Guard for owner note N15: in Sorani and Arabic no intensity is a Roman
 * numeral (digits instead); English and Kurmanji keep Roman.
 */

const HALABJA_EPICENTER = { lat: 34.9109, lon: 45.9592 };

async function themeArgs() {
  const { result, unmount } = await renderHook(() => useTheme());
  const theme = result.current;
  // Unmount so a later language change does not re-render it outside act().
  unmount();
  return theme;
}

async function inLanguage(code: string, run: () => Promise<void>) {
  const original = i18n.language;
  await i18n.changeLanguage(code);
  try {
    await run();
  } finally {
    cleanup();
    await i18n.changeLanguage(original);
  }
}

function everything(): string[] {
  const tree = screen.toJSON();
  return [...collectText(tree), ...collectLabels(tree)];
}

describe.each(["ckb", "ar"])("intensity numerals in %s", (code) => {
  it("legend: digits, no Roman", async () => {
    const { colors, typography, spacing } = await themeArgs();
    await inLanguage(code, async () => {
      await render(
        <ShakeMapLegend
          layer="intensity"
          locale={code}
          t={i18n.t}
          colors={colors}
          typography={typography}
          spacing={spacing}
        />,
      );
      const texts = everything();
      expect(texts.filter((text) => ROMAN_NUMERAL.test(text))).toEqual([]);
      expect(screen.getByText("٥", { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText("١٢", { includeHiddenElements: true })).toBeTruthy();
    });
  });

  it("map description (the contour level read to screen readers): digits, no Roman", async () => {
    await inLanguage(code, async () => {
      await render(
        <ShakeMapView
          contours={parseIntensityContours(halabjaContours)}
          epicenter={HALABJA_EPICENTER}
          locale={code}
          t={i18n.t}
          placeText="Halabja"
        />,
      );
      const label = screen.getByTestId("shakemap-map-container").props
        .accessibilityLabel as string;
      expect(label).toBeTruthy();
      expect(ROMAN_NUMERAL.test(label)).toBe(false);
      expect(everything().filter((text) => ROMAN_NUMERAL.test(text))).toEqual([]);
    });
  });

  it("people by shaking level: digits, no Roman, in rows and spoken labels", async () => {
    const { colors, typography, spacing } = await themeArgs();
    await inLanguage(code, async () => {
      await render(
        <RiskShakingLevels
          populationByIntensity={{ 4: 1_200_000, 5: 800_000, 6: 150_000, 7: 20_000 }}
          locale={code}
          t={i18n.t}
          colors={colors}
          typography={typography}
          spacing={spacing}
        />,
      );
      expect(everything().filter((text) => ROMAN_NUMERAL.test(text))).toEqual([]);
      expect(screen.getByText("٦")).toBeTruthy();
    });
  });
});

describe.each(["en", "kmr"])("intensity numerals in %s", (code) => {
  it("legend and people rows keep Roman numerals", async () => {
    const { colors, typography, spacing } = await themeArgs();
    await inLanguage(code, async () => {
      await render(
        <>
          <ShakeMapLegend
            layer="intensity"
            locale={code}
            t={i18n.t}
            colors={colors}
            typography={typography}
            spacing={spacing}
          />
          <RiskShakingLevels
            populationByIntensity={{ 6: 150_000 }}
            locale={code}
            t={i18n.t}
            colors={colors}
            typography={typography}
            spacing={spacing}
          />
        </>,
      );
      expect(
        screen.getAllByText("VI", { includeHiddenElements: true }).length,
      ).toBeGreaterThan(0);
      expect(screen.getByText("XII", { includeHiddenElements: true })).toBeTruthy();
    });
  });
});
