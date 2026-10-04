import { act, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

import { MapOverlayInfoCard } from "../components/MapOverlayInfoCard";
import { MapOverlayLegend } from "../components/MapOverlayLegend";

describe("map overlay legend and card", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("renders nothing without active layers, and only the active sections otherwise", async () => {
    const { toJSON } = await render(<MapOverlayLegend active={[]} compact={false} />);
    expect(toJSON()).toBeNull();
    await render(
      <MapOverlayLegend active={["faults-afead", "site-vs30"]} compact={false} />,
    );
    expect(screen.getByText(i18n.t("map.legend.faults"))).toBeTruthy();
    expect(screen.getByText(i18n.t("map.legend.afeadConfidence"))).toBeTruthy();
    expect(screen.getByText(i18n.t("map.legend.site"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("map.legend.quakes"))).toBeNull();
  });

  it("starts collapsed on a phone and opens on tap", async () => {
    await render(<MapOverlayLegend active={["historical-quakes"]} compact />);
    expect(screen.queryByText(i18n.t("map.legend.quakes"))).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: i18n.t("map.legend.title") }));
    });
    expect(screen.getByText(i18n.t("map.legend.eraHistorical"))).toBeTruthy();
  });

  it("describes an AFEAD fault with its source named", async () => {
    const onClose = jest.fn();
    await render(
      <MapOverlayInfoCard
        onClose={onClose}
        info={{
          kind: "fault",
          source: "afead",
          name: "Chalderan",
          zone: null,
          primary: "dextral",
          secondary: "reverse",
          slipRate: null,
          rateRank: "1",
          confidence: "A",
          references: "Trifonov et al., 1994",
          catalog: null,
        }}
      />,
    );
    expect(screen.getByText("Chalderan")).toBeTruthy();
    expect(
      screen.getByText("Right-lateral strike-slip fault, with a reverse component"),
    ).toBeTruthy();
    expect(screen.getByText(i18n.t("map.overlayInfo.rateRank1"))).toBeTruthy();
    expect(screen.getByText(i18n.t("map.overlayInfo.sourceAfead"))).toBeTruthy();
    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: i18n.t("map.overlayInfo.close") }),
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("describes a historical earthquake with its uncertainty note, in Sorani digits", async () => {
    await act(async () => {
      await i18n.changeLanguage("ckb");
    });
    await render(
      <MapOverlayInfoCard
        onClose={() => {}}
        info={{
          kind: "quake",
          id: "bml08720001",
          year: 872,
          timeMs: null,
          magnitude: 6.8,
          magType: "Mw",
          depthKm: null,
          source: "EMME",
          era: "historical",
        }}
      />,
    );
    expect(screen.getByText(/٨٧٢/)).toBeTruthy();
    expect(screen.getByText(i18n.t("map.overlayInfo.era.historical"))).toBeTruthy();
    expect(screen.getByText(/EMME · bml08720001/)).toBeTruthy();
  });
});
