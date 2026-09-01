import { fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import i18n from "@/i18n";
import { useTheme } from "@/theme";
import { RiskProvenanceChips } from "../components/RiskProvenanceChips";

async function themeArgs() {
  const { result } = await renderHook(() => useTheme());
  return result.current;
}

const BASE_PROPS = {
  stage: "pga_lognormal",
  timeOfDay: "night" as const,
  nDraws: 200,
  reviewStatus: "automatic" as const,
  locale: "en",
  t: i18n.t,
};

describe("RiskProvenanceChips", () => {
  it("renders provisional/time-of-day/simulation/fragility chips and never the raw stage code", async () => {
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskProvenanceChips {...BASE_PROPS} reportUrl={null} colors={colors} typography={typography} spacing={spacing} />,
    );

    expect(screen.getByText(i18n.t("eventDetail.risk.chips.provisional"))).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.risk.chips.timeOfDay.night"))).toBeTruthy();
    expect(
      screen.getByText(i18n.t("eventDetail.risk.chips.simulations", { count: "200" })),
    ).toBeTruthy();
    expect(screen.queryByText(/pga_lognormal/)).toBeNull();
  });

  it("falls back to a generic fragility label for an unrecognized stage code, never leaking the raw code", async () => {
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskProvenanceChips
        {...BASE_PROPS}
        stage="some_future_stage_v9"
        reportUrl={null}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(
      screen.getByText(
        i18n.t("eventDetail.risk.chips.fragility", { method: i18n.t("eventDetail.risk.stageNames.unknown") }),
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/some_future_stage_v9/)).toBeNull();
  });

  it("hides the download button when reportUrl is null", async () => {
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskProvenanceChips {...BASE_PROPS} reportUrl={null} colors={colors} typography={typography} spacing={spacing} />,
    );

    expect(screen.queryByTestId("risk-download-report")).toBeNull();
  });

  it("opens the report URL when the download button is pressed", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
    const { colors, typography, spacing } = await themeArgs();
    const reportUrl = "https://example.test/events/us6000jllz/v5/report.pdf";
    await render(
      <RiskProvenanceChips {...BASE_PROPS} reportUrl={reportUrl} colors={colors} typography={typography} spacing={spacing} />,
    );

    await fireEvent.press(screen.getByTestId("risk-download-report"));
    await Promise.resolve();

    expect(openURL).toHaveBeenCalledWith(reportUrl);
    openURL.mockRestore();
  });

  it("fails soft into an inline offline message when opening the report URL rejects (never a crash)", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockRejectedValue(new Error("no network"));
    const { colors, typography, spacing } = await themeArgs();
    const reportUrl = "https://example.test/events/us6000jllz/v5/report.pdf";
    await render(
      <RiskProvenanceChips {...BASE_PROPS} reportUrl={reportUrl} colors={colors} typography={typography} spacing={spacing} />,
    );

    await fireEvent.press(screen.getByTestId("risk-download-report"));
    // Let the rejected promise's `.catch` settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      await screen.findByText(i18n.t("eventDetail.risk.downloadReportOffline")),
    ).toBeTruthy();
    openURL.mockRestore();
  });

  it("shows the reviewed chip for a scientist-reviewed product", async () => {
    const { colors, typography, spacing } = await themeArgs();
    await render(
      <RiskProvenanceChips
        {...BASE_PROPS}
        reviewStatus="reviewed"
        reportUrl={null}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />,
    );

    expect(screen.getByText(i18n.t("eventDetail.risk.chips.reviewed"))).toBeTruthy();
  });
});
