import { cleanup, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

import { ContributionRow } from "../components/ContributionRow";
import type { ContributionRowViewModel } from "../format";

const BASE_ROW: ContributionRowViewModel = {
  reportId: "report-1",
  dateText: "12 Aug 2026, 3:12 pm",
  eventLabel: null,
  level: 4,
  levelLabel: "4 - Felt by many",
  damage: null,
  syncStatus: "on-device",
  syncStatusText: "On this device",
  hasPhoto: false,
};

describe("ContributionRow", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders the level artwork thumbnail, level label, date, and sync status", async () => {
    await render(<ContributionRow row={BASE_ROW} />);

    expect(screen.getByText("4 - Felt by many")).toBeTruthy();
    expect(screen.getByText("12 Aug 2026, 3:12 pm")).toBeTruthy();
    expect(screen.getByText("On this device")).toBeTruthy();
    expect(
      screen.getByTestId("mydata-level-artwork", { includeHiddenElements: true }),
    ).toBeTruthy();
    // No damage was recorded — no damage thumbnail should render.
    expect(screen.queryByTestId("mydata-damage-artwork", { includeHiddenElements: true })).toBeNull();
  });

  it("shows the unassigned-event fallback text when the report has no eventLabel", async () => {
    await render(<ContributionRow row={BASE_ROW} />);

    expect(screen.getByText("Not linked to a specific event")).toBeTruthy();
  });

  it("shows the event place name instead of the fallback when eventLabel is set", async () => {
    await render(<ContributionRow row={{ ...BASE_ROW, eventLabel: "32 km SE of Halabja, Iraq" }} />);

    expect(screen.getByText("32 km SE of Halabja, Iraq")).toBeTruthy();
    expect(screen.queryByText("Not linked to a specific event")).toBeNull();
  });

  it("renders the damage thumbnail and line when a damage grade is present", async () => {
    await render(
      <ContributionRow
        row={{
          ...BASE_ROW,
          damage: {
            typology: "lowrise",
            grade: 2,
            label: "Large wall cracks, some fallen plaster or masonry",
            typologyLabel: "Single-storey or low-rise building (Iraqi-typical)",
          },
        }}
      />,
    );

    expect(
      screen.getByTestId("mydata-damage-artwork", { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Single-storey or low-rise building (Iraqi-typical): Large wall cracks, some fallen plaster or masonry",
      ),
    ).toBeTruthy();
  });

  it("shows a distinct color/label for a submitted report", async () => {
    await render(
      <ContributionRow row={{ ...BASE_ROW, syncStatus: "submitted", syncStatusText: "Submitted" }} />,
    );

    expect(screen.getByText("Submitted")).toBeTruthy();
  });

  it("shows the photo-attached indicator when hasPhoto is true, and hides it otherwise", async () => {
    await render(<ContributionRow row={{ ...BASE_ROW, hasPhoto: true }} />);
    expect(screen.getByText("Photo attached")).toBeTruthy();

    cleanup();
    await render(<ContributionRow row={BASE_ROW} />);
    expect(screen.queryByText("Photo attached")).toBeNull();
  });
});
