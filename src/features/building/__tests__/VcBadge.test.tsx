import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { VC_COLORS, VcBadge } from "../components/VcBadge";
import { VULNERABILITY_CLASSES } from "../ims25";

describe("VcBadge", () => {
  it("uses the colour scale of the owner's building-stock papers", () => {
    expect(VC_COLORS.A.fill).toBe("#E73710");
    expect(VC_COLORS.C.fill).toBe("#DFF3AE");
    expect(VC_COLORS.F.fill).toBe("#58135B");
    expect(Object.keys(VC_COLORS)).toEqual([...VULNERABILITY_CLASSES]);
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
