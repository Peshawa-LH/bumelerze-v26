import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  damageGradeOnFillDark,
  damageGradeOnFillLight,
  damageGradePalette,
  intensityOnFillDark,
  intensityOnFillLight,
  intensityRamp,
  logoBrand,
  neutral,
} from "../palette";
import { darkColors, lightColors } from "../semantic";

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
const DARK_SURFACE = "#141414"; // colors.surface.raised, dark theme
const LIGHT_SURFACE = "#FFFFFF"; // colors.surface.base, light theme

describe("intensity ramp — toolkit provenance (ui-backlog.md item 8)", () => {
  it("has exactly 13 entries (index 0 unused placeholder + I..XII)", () => {
    expect(intensityRamp).toHaveLength(13);
    expect(intensityOnFillLight).toHaveLength(13);
    expect(intensityOnFillDark).toHaveLength(13);
    expect(intensityRamp[0]).toBe("");
  });

  it("matches the toolkit's ems_colors extraction verbatim for levels I-X", () => {
    // SHAKEmaps-Toolkit-v26/modules/utils/SHAKEtools.py, contour_scale(...,
    // scale_type="ems"), the `ems_colors` list — see palette.ts's provenance
    // comment for the full citation. XI/XII are NOT toolkit-verbatim as of
    // the 2026-08-17 light/dark unification wave (see palette.ts's own
    // [REVIEW visual] comment) — checked separately below.
    expect(intensityRamp.slice(0, 11)).toEqual([
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
    ]);
  });

  it("does NOT merge II and III into a shared swatch (the old placeholder's convention) — the toolkit gives each its own color", () => {
    expect(intensityRamp[2]).not.toBe(intensityRamp[3]);
  });

  it("clears a 3:1 contrast floor against the dark theme's card background (#141414) for every level, including XI/XII", () => {
    for (let level = 1; level <= 12; level += 1) {
      const fill = intensityRamp[level];
      expect(fill).toBeDefined();
      expect(contrastRatio(fill!, DARK_SURFACE)).toBeGreaterThanOrEqual(3);
    }
  });

  it("XI/XII clear a 3:1 contrast floor against the light theme's surface (#FFFFFF) — the other requirement the unification had to hold simultaneously (level I is deliberately white-on-white, see the array's own doc comment, so this is scoped to the two changed levels, not all 12)", () => {
    for (const level of [11, 12]) {
      const fill = intensityRamp[level];
      expect(fill).toBeDefined();
      expect(contrastRatio(fill!, LIGHT_SURFACE)).toBeGreaterThanOrEqual(3);
    }
  });

  it("XI/XII (2026-08-17 unification): pins the exact unified hex values so a future change is caught, not silently accepted", () => {
    expect(intensityRamp[11]).toBe("#DB0000");
    expect(intensityRamp[12]).toBe("#CC0000");
  });

  it("XI/XII stay ordered as increasing severity after X (each level darker/lower-luminance than the last)", () => {
    const lumX = relativeLuminance(intensityRamp[10]!);
    const lumXI = relativeLuminance(intensityRamp[11]!);
    const lumXII = relativeLuminance(intensityRamp[12]!);
    expect(lumXI).toBeLessThan(lumX);
    expect(lumXII).toBeLessThan(lumXI);
  });

  it("XI/XII pin their exact measured contrast figures against both surfaces", () => {
    expect(contrastRatio(intensityRamp[11]!, DARK_SURFACE)).toBeCloseTo(3.52, 1);
    expect(contrastRatio(intensityRamp[11]!, LIGHT_SURFACE)).toBeCloseTo(5.23, 1);
    expect(contrastRatio(intensityRamp[12]!, DARK_SURFACE)).toBeCloseTo(3.13, 1);
    expect(contrastRatio(intensityRamp[12]!, LIGHT_SURFACE)).toBeCloseTo(5.89, 1);
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
      const fill = intensityRamp[level];
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
    const fill = intensityRamp[9];
    expect(fill).toBe("#DF532A");
    expect(contrastRatio(fill!, LIGHT_DARK_TEXT)).toBeCloseTo(4.293, 2);
    expect(contrastRatio(fill!, LIGHT_LIGHT_TEXT)).toBeCloseTo(3.883, 2);
  });

  it("dark theme: every level's chosen on-fill color is the higher-contrast of the two available text options", () => {
    for (let level = 1; level <= 12; level += 1) {
      const fill = intensityRamp[level];
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

describe("damage-grade palette — own 5-color set, decoupled from the intensity ramp (2026-08-17 update wave §2.2b)", () => {
  it("has exactly 6 entries (index 0 unused placeholder + DG1..DG5) in every array", () => {
    expect(damageGradePalette).toHaveLength(6);
    expect(damageGradeOnFillLight).toHaveLength(6);
    expect(damageGradeOnFillDark).toHaveLength(6);
    expect(damageGradePalette[0]).toBe("");
  });

  it("matches the owner-specified hexes exactly for DG3/DG4/DG5", () => {
    expect(damageGradePalette[3]).toBe("#F9EC33");
    expect(damageGradePalette[4]).toBe("#DF532A");
    expect(damageGradePalette[5]).toBe("#440001");
  });

  it("DG2 (light green) reuses the intensity ramp's level V verbatim", () => {
    expect(damageGradePalette[2]).toBe(intensityRamp[5]);
  });

  it("DG1 (dark green) is a distinct new token, not a re-hue of DG2 or any status color", () => {
    expect(damageGradePalette[1]).toBe("#1B5E20");
    expect(damageGradePalette[1]).not.toBe(damageGradePalette[2]);
  });

  it("every swatch's chosen on-fill text (both themes) is the higher-contrast of the two available options", () => {
    const BORDERLINE_GRADES = new Set([4]); // #DF532A, same borderline case as the ramp's IX

    for (let grade = 1; grade <= 5; grade += 1) {
      const fill = damageGradePalette[grade];
      expect(fill).toBeDefined();

      const lightDarkOption = contrastRatio(fill!, LIGHT_DARK_TEXT);
      const lightLightOption = contrastRatio(fill!, LIGHT_LIGHT_TEXT);
      const expectedLight =
        lightDarkOption >= lightLightOption ? LIGHT_DARK_TEXT : LIGHT_LIGHT_TEXT;
      expect(damageGradeOnFillLight[grade]).toBe(expectedLight);
      expect(Math.max(lightDarkOption, lightLightOption)).toBeGreaterThanOrEqual(
        BORDERLINE_GRADES.has(grade) ? 3 : 4.5,
      );

      const darkDarkOption = contrastRatio(fill!, DARK_DARK_TEXT);
      const darkLightOption = contrastRatio(fill!, DARK_LIGHT_TEXT);
      const expectedDark =
        darkDarkOption >= darkLightOption ? DARK_DARK_TEXT : DARK_LIGHT_TEXT;
      expect(damageGradeOnFillDark[grade]).toBe(expectedDark);
      expect(Math.max(darkDarkOption, darkLightOption)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("text.tertiary — WCAG-AA contrast against surface.base (accessibility-tester Phase 5)", () => {
  // Real screen content uses this token at normal (not "large") text sizes
  // — notificationSettings.homeBase.notSetHint, .fatigueFooter,
  // sensor.gravityNote — plus the always-visible bottom-tab-bar inactive
  // icon/label color, so it needs the full 4.5:1 normal-text floor, not
  // just the 3:1 large-text/graphical-object floor.
  const AA_NORMAL_TEXT_FLOOR = 4.5;

  it("light theme: text.tertiary on surface.base clears 4.5:1 (previously neutral[500] at ~2.43:1 — a real AA failure)", () => {
    expect(lightColors.text.tertiary).toBe(neutral[650]);
    expect(
      contrastRatio(lightColors.text.tertiary, lightColors.surface.base),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_FLOOR);
  });

  it("dark theme: text.tertiary on surface.base clears 4.5:1 (previously neutral[700] at ~3.1:1 — a real AA failure)", () => {
    expect(darkColors.text.tertiary).toBe(neutral[600]);
    expect(
      contrastRatio(darkColors.text.tertiary, darkColors.surface.base),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_FLOOR);
  });

  it("keeps text.tertiary visibly distinct from text.secondary in both themes (a hierarchy, not a duplicate)", () => {
    expect(lightColors.text.tertiary).not.toBe(lightColors.text.secondary);
    expect(darkColors.text.tertiary).not.toBe(darkColors.text.secondary);
  });
});

describe("brand.onPrimary (dark theme) — WCAG-AA contrast against brand.primary (accessibility-tester Phase 5)", () => {
  // This pair is the primary CTA button text/fill combo used on nearly
  // every onboarding + felt-report screen — a real, high-traffic failure,
  // not an edge case.
  it("dark theme: brand.onPrimary on brand.primary clears 4.5:1 (previously neutral[1100] at ~3.89:1 — a real AA failure)", () => {
    expect(darkColors.brand.onPrimary).toBe(neutral[0]);
    expect(
      contrastRatio(darkColors.brand.onPrimary, darkColors.brand.primary),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("logoBrand — must never drift from the logo package's own tokens", () => {
  // palette.ts's `logoBrand` is a hand-copy (React Native has no runtime
  // filesystem access to read the JSON file directly) — this test is the
  // guard against that copy going stale, reading the same JSON file this
  // Node/Jest process CAN see.
  const tokensPath = join(
    __dirname,
    "../../../assets/Bumelerze-App-Visual-Assets/08-Logo_Package/Design-Tokens/bumelerze-colors.json",
  );
  const tokens = JSON.parse(readFileSync(tokensPath, "utf8")) as {
    colors: Record<string, { hex: string }>;
  };

  it.each([
    ["signalRed", "signal-red"],
    ["warmIvory", "warm-ivory"],
    ["endpointGold", "endpoint-gold"],
    ["wordmarkInk", "wordmark-ink"],
    ["approvedNavy", "approved-navy"],
    ["presentationOffWhite", "presentation-off-white"],
  ] as const)("logoBrand.%s matches the logo package's colors['%s']", (key, tokenKey) => {
    expect(logoBrand[key]).toBe(tokens.colors[tokenKey]?.hex);
  });
});
