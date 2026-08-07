import {
  intensityOnFillDark,
  intensityOnFillLight,
  intensityRampDark,
  intensityRampLight,
} from "../palette";

/**
 * Standalone WCAG 2.x relative-luminance/contrast-ratio helpers, reimplemented
 * here (not imported from app code — there is no shared contrast utility
 * yet) so this test independently verifies the "per-swatch on-fill color
 * chosen for contrast" invariant rather than just re-asserting the same
 * hand-picked values the palette file already hardcodes.
 */
function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return [r, g, b];
}

function channelLuminance(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

const LIGHT_DARK_TEXT = "#1E1E1E"; // neutral[1000], intensityOnFillLight's dark option
const LIGHT_LIGHT_TEXT = "#FFFFFF"; // intensityOnFillLight's white option
const DARK_DARK_TEXT = "#161616"; // intensityOnFillDark's dark option
const DARK_LIGHT_TEXT = "#F2F2F3"; // intensityOnFillDark's white option

describe("intensity ramp — toolkit provenance (ui-backlog.md item 8)", () => {
  it("has exactly 13 entries (index 0 unused placeholder + I..XII) in every ramp/onFill array", () => {
    expect(intensityRampLight).toHaveLength(13);
    expect(intensityRampDark).toHaveLength(13);
    expect(intensityOnFillLight).toHaveLength(13);
    expect(intensityOnFillDark).toHaveLength(13);
    expect(intensityRampLight[0]).toBe("");
    expect(intensityRampDark[0]).toBe("");
  });

  it("matches the toolkit's ems_colors extraction verbatim for the light ramp", () => {
    // SHAKEmaps-Toolkit-v26/modules/utils/SHAKEtools.py, contour_scale(...,
    // scale_type="ems"), the `ems_colors` list — see palette.ts's provenance
    // comment for the full citation.
    expect(intensityRampLight).toEqual([
      "",
      "#FFFFFF",
      "#EDEFF3",
      "#ACB4CE",
      "#A1D7E3",
      "#8FC891",
      "#F9EC33",
      "#EEB509",
      "#E9872D",
      "#DF532A",
      "#D9262A",
      "#880000",
      "#440001",
    ]);
  });

  it("does NOT merge II and III into a shared swatch (the old placeholder's convention) — the toolkit gives each its own color", () => {
    expect(intensityRampLight[2]).not.toBe(intensityRampLight[3]);
  });

  it("keeps levels I-X byte-identical between light and dark (no re-hue of the scientific scale)", () => {
    for (let level = 1; level <= 10; level += 1) {
      expect(intensityRampDark[level]).toBe(intensityRampLight[level]);
    }
  });

  it("only adjusts XI/XII in dark mode, and only to lighten them (fixing the true-black 'vanishes' bug)", () => {
    for (const level of [11, 12]) {
      const light = intensityRampLight[level];
      const dark = intensityRampDark[level];
      expect(light).toBeDefined();
      expect(dark).toBeDefined();
      expect(dark).not.toBe(light);
      // The dark-mode adjustment must be a genuine lightening, not an
      // arbitrary re-color — i.e. strictly higher relative luminance.
      expect(relativeLuminance(dark!)).toBeGreaterThan(relativeLuminance(light!));
    }
  });

  it("clears a 3:1 contrast floor against the dark theme's card background (#141414) for every level, including the adjusted XI/XII", () => {
    const DARK_CARD_BACKGROUND = "#141414"; // colors.surface.raised, dark theme
    for (let level = 1; level <= 12; level += 1) {
      const fill = intensityRampDark[level];
      expect(fill).toBeDefined();
      expect(contrastRatio(fill!, DARK_CARD_BACKGROUND)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("intensity on-fill text color — WCAG contrast, not eyeballed", () => {
  it("light theme: every level's chosen on-fill color is the higher-contrast of the two available text options", () => {
    // Level IX (`#DF532A`) is a documented, deliberate exception (see
    // palette.ts's on-fill comment): its best available option only
    // reaches ~4.29:1 (below the 4.5:1 AA-normal-text ratio every other
    // level clears), so it's checked against the 3:1 WCAG 1.4.11
    // "graphical object" floor instead of 4.5.
    const BORDERLINE_LEVELS = new Set([9]);

    for (let level = 1; level <= 12; level += 1) {
      const fill = intensityRampLight[level];
      const chosen = intensityOnFillLight[level];
      expect(fill).toBeDefined();
      expect(chosen).toBeDefined();

      const darkOption = contrastRatio(fill!, LIGHT_DARK_TEXT);
      const lightOption = contrastRatio(fill!, LIGHT_LIGHT_TEXT);
      const expected = darkOption >= lightOption ? LIGHT_DARK_TEXT : LIGHT_LIGHT_TEXT;
      const bestRatio = Math.max(darkOption, lightOption);

      expect(chosen).toBe(expected);
      expect(bestRatio).toBeGreaterThanOrEqual(BORDERLINE_LEVELS.has(level) ? 3 : 4.5);
    }
  });

  it("pins level IX's exact borderline contrast figures so a future hex change is caught, not silently accepted", () => {
    const fill = intensityRampLight[9];
    expect(fill).toBe("#DF532A");
    expect(contrastRatio(fill!, LIGHT_DARK_TEXT)).toBeCloseTo(4.293, 2);
    expect(contrastRatio(fill!, LIGHT_LIGHT_TEXT)).toBeCloseTo(3.883, 2);
  });

  it("dark theme: every level's chosen on-fill color is the higher-contrast of the two available text options", () => {
    for (let level = 1; level <= 12; level += 1) {
      const fill = intensityRampDark[level];
      const chosen = intensityOnFillDark[level];
      expect(fill).toBeDefined();
      expect(chosen).toBeDefined();

      const darkOption = contrastRatio(fill!, DARK_DARK_TEXT);
      const lightOption = contrastRatio(fill!, DARK_LIGHT_TEXT);
      const expected = darkOption >= lightOption ? DARK_DARK_TEXT : DARK_LIGHT_TEXT;

      expect(chosen).toBe(expected);
      expect(Math.max(darkOption, lightOption)).toBeGreaterThanOrEqual(3);
    }
  });
});
