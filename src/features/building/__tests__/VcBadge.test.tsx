import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { VC_COLORS, VcBadge } from "../components/VcBadge";
import { VULNERABILITY_CLASSES } from "../ims25";

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe("VcBadge", () => {
  it("uses the colour scale of the owner's building-stock papers, class A a shade darker for contrast (review E-2)", () => {
    expect(VC_COLORS.A.fill).toBe("#D32F0C");
    expect(VC_COLORS.C.fill).toBe("#DFF3AE");
    expect(VC_COLORS.F.fill).toBe("#58135B");
    expect(Object.keys(VC_COLORS)).toEqual([...VULNERABILITY_CLASSES]);
  });

  it.each(VULNERABILITY_CLASSES)("class %s letter on its fill meets AA (4.5:1)", (vc) => {
    expect(contrast(VC_COLORS[vc].fill, VC_COLORS[vc].text)).toBeGreaterThanOrEqual(4.5);
  });

  it("white on the class A fill clears 4.6:1 (the published #E73710 gave 4.24:1)", () => {
    expect(contrast("#E73710", "#FFFFFF")).toBeLessThan(4.5);
    expect(contrast(VC_COLORS.A.fill, VC_COLORS.A.text)).toBeGreaterThanOrEqual(4.6);
  });

  it.each(VULNERABILITY_CLASSES)(
    "paints class %s with its fill and readable text",
    async (vc) => {
      await render(<VcBadge vc={vc} label={`Class ${vc}`} testID="badge" />);
      const badge = StyleSheet.flatten(screen.getByTestId("badge").props.style);
      expect(badge.backgroundColor).toBe(VC_COLORS[vc].fill);
      const letter = StyleSheet.flatten(screen.getByText(vc).props.style);
      expect(letter.color).toBe(VC_COLORS[vc].text);
    },
  );
});
