import { fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import type { Event } from "@/features/events";
import {
  CHAMCHAMAL_CENTER,
  CHAMCHAMAL_FELT_MAP_FIXTURE,
} from "../__fixtures__/chamchamal";
import { selectFeltMapCells } from "../cell-selection";
import { FeltMapSection } from "../components/FeltMapSection";
import { useFeltMap } from "../queries";
import type { UseFeltMapResult } from "../queries";

jest.mock("../queries", () => ({
  useFeltMap: jest.fn(),
}));

const mockedUseFeltMap = useFeltMap as jest.MockedFunction<typeof useFeltMap>;

const CHAMCHAMAL_EVENT: Event = {
  id: "fixture-chamchamal-20260813",
  originTime: Date.UTC(2026, 7, 13, 22, 28, 0),
  lat: CHAMCHAMAL_CENTER.lat,
  lon: CHAMCHAMAL_CENTER.lon,
  depthKm: 10,
  magnitude: { value: 4.0, type: "mb" },
  placeName: "Chamchamal, Iraq",
  provenance: {
    provider: "emsc",
    providerId: "fixture-chamchamal-20260813",
    fetchedAt: Date.now(),
    providerUpdatedAt: Date.now(),
  },
  sig: 400,
  isRegional: true,
  url: "",
};

function readyResult(overrides: Partial<UseFeltMapResult> = {}): UseFeltMapResult {
  const cells = selectFeltMapCells(CHAMCHAMAL_FELT_MAP_FIXTURE);
  return {
    status: "ready",
    cells,
    totalReports: cells.reduce((sum, cell) => sum + cell.n_reports, 0),
    dataUpdatedAt: Date.UTC(2026, 7, 14, 3, 0, 0),
    refetch: jest.fn(),
    ...overrides,
  };
}

describe("FeltMapSection", () => {
  beforeEach(() => {
    mockedUseFeltMap.mockReset();
  });

  it("renders nothing at all for the hidden case (no empty-state noise)", async () => {
    mockedUseFeltMap.mockReturnValue({
      status: "hidden",
      cells: [],
      totalReports: 0,
      dataUpdatedAt: 0,
      refetch: jest.fn(),
    });

    const { toJSON } = await render(<FeltMapSection event={CHAMCHAMAL_EVENT} />);
    expect(toJSON()).toBeNull();
  });

  it("renders the section title, map, updated line, and citation when ready", async () => {
    mockedUseFeltMap.mockReturnValue(readyResult());

    await render(<FeltMapSection event={CHAMCHAMAL_EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.feltMap.sectionTitle"))).toBeTruthy();
    expect(screen.getByTestId("feltmap-map-container")).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.feltMap.citation"))).toBeTruthy();
  });

  it("shows the offline/failure state with a retry affordance, never blank/error, when the query fails", async () => {
    const refetch = jest.fn();
    mockedUseFeltMap.mockReturnValue({
      status: "offline",
      cells: [],
      totalReports: 0,
      dataUpdatedAt: 0,
      refetch,
    });

    await render(<FeltMapSection event={CHAMCHAMAL_EVENT} />);

    expect(screen.getByText(i18n.t("eventDetail.feltMap.sectionTitle"))).toBeTruthy();
    expect(screen.getByText(i18n.t("eventDetail.feltMap.unavailableOffline"))).toBeTruthy();

    const retryButton = screen.getByText(i18n.t("eventDetail.feltMap.retry"));
    fireEvent.press(retryButton);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("never renders cell rects in the offline state (no stale map alongside the failure message)", async () => {
    mockedUseFeltMap.mockReturnValue({
      status: "offline",
      cells: [],
      totalReports: 0,
      dataUpdatedAt: 0,
      refetch: jest.fn(),
    });

    await render(<FeltMapSection event={CHAMCHAMAL_EVENT} />);

    expect(screen.queryByTestId("feltmap-map-container")).toBeNull();
  });
});
