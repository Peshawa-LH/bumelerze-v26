import { darkColors, lightColors } from "@/theme/semantic";

import { MILESTONE_BADGES, ROLE_BADGES, type BadgeTone } from "../catalog";
import {
  EARNED_TINT_ALPHA,
  GRAPHIC_MIN_CONTRAST,
  accessibleAccent,
  badgePalette,
  blendOver,
  contrastRatio,
  toneColor,
  withAlpha,
} from "../tones";

const TONES: BadgeTone[] = ["info", "success", "brand", "link", "warning"];
const THEMES = [
  ["light", lightColors],
  ["dark", darkColors],
] as const;

describe("badge colours", () => {
  it("maps tones to the theme tokens", () => {
    expect(toneColor("info", lightColors)).toBe(lightColors.status.info);
    expect(toneColor("success", darkColors)).toBe(darkColors.status.success);
    expect(toneColor("brand", darkColors)).toBe(darkColors.brand.primary);
    expect(toneColor("link", lightColors)).toBe(lightColors.text.link);
    expect(toneColor("warning", lightColors)).toBe(lightColors.status.warning);
  });

  it("writes translucent tints", () => {
    expect(withAlpha("#2E6E9E", 0.16)).toBe("rgba(46, 110, 158, 0.16)");
    expect(blendOver("#000000", 0.5, "#ffffff")).toBe("#808080");
  });

  it("only the tones the catalogue uses are in play", () => {
    const used = new Set<BadgeTone>([
      ...MILESTONE_BADGES.map((b) => b.tone),
      ...Object.values(ROLE_BADGES).map((r) => r.tone),
    ]);
    for (const tone of used) {
      expect(TONES).toContain(tone);
    }
  });

  describe.each(THEMES)("%s theme", (scheme, colors) => {
    it.each(TONES)(
      "earned %s glyph and ring reach 3:1 on the tint and on the card",
      (tone) => {
        const palette = badgePalette(tone, true, colors, scheme);
        const tint = blendOver(
          toneColor(tone, colors),
          EARNED_TINT_ALPHA,
          colors.surface.raised,
        );
        expect(contrastRatio(palette.glyph, tint)).toBeGreaterThanOrEqual(
          GRAPHIC_MIN_CONTRAST,
        );
        expect(
          contrastRatio(palette.ring as string, colors.surface.raised),
        ).toBeGreaterThanOrEqual(GRAPHIC_MIN_CONTRAST);
        expect(accessibleAccent(tone, colors, scheme)).toBe(palette.glyph);
      },
    );

    it("locked glyph reaches 3:1 on the grey fill and on the card", () => {
      const palette = badgePalette("info", false, colors, scheme);
      expect(palette.ring).toBeNull();
      expect(contrastRatio(palette.glyph, palette.fill)).toBeGreaterThanOrEqual(
        GRAPHIC_MIN_CONTRAST,
      );
      expect(contrastRatio(palette.glyph, colors.surface.raised)).toBeGreaterThanOrEqual(
        GRAPHIC_MIN_CONTRAST,
      );
    });
  });
});
