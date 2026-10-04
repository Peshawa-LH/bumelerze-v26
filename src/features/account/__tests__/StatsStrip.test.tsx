import { cleanup, render, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";

import i18n from "@/i18n";

import { StatsStrip, type StatsStripProps } from "../components/StatsStrip";

const BASE: StatsStripProps = {
  reports: 12,
  comments: 4,
  helpful: 9,
  badgesEarned: 5,
  badgesTotal: 9,
  signedIn: true,
  loading: false,
};

function setFontScale(fontScale: number) {
  Dimensions.set({
    window: { width: 360, height: 640, scale: 2, fontScale },
    screen: { width: 360, height: 640, scale: 2, fontScale },
  });
}

function cellWidths(): string[] {
  return screen.getAllByTestId(/^stat-(reports|comments|helpful|badges)$/).map((cell) => {
    const flat = ([] as object[]).concat(...[cell.props.style].flat());
    return (flat.find((s) => "width" in s) as { width: string }).width;
  });
}

describe("StatsStrip", () => {
  beforeEach(async () => {
    setFontScale(1);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(() => {
    cleanup();
    setFontScale(2);
  });

  it("signed in: four cells in one row, each one accessible unit with its figure", async () => {
    await render(<StatsStrip {...BASE} />);
    expect(cellWidths()).toEqual(["25%", "25%", "25%", "25%"]);
    expect(screen.getByLabelText("Reports: 12")).toBeTruthy();
    expect(screen.getByLabelText("Comments: 4")).toBeTruthy();
    expect(screen.getByLabelText("Helpful: 9")).toBeTruthy();
    expect(screen.getByLabelText("Badges: 5/9")).toBeTruthy();
  });

  it("anonymous: only Reports and Badges", async () => {
    await render(<StatsStrip {...BASE} signedIn={false} />);
    expect(cellWidths()).toEqual(["50%", "50%"]);
    expect(screen.queryByTestId("stat-comments")).toBeNull();
    expect(screen.queryByTestId("stat-helpful")).toBeNull();
  });

  it("becomes a 2 x 2 grid at a large system font scale", async () => {
    setFontScale(2);
    await render(<StatsStrip {...BASE} />);
    expect(cellWidths()).toEqual(["50%", "50%", "50%", "50%"]);
  });

  it("stays two cells (not a grid) for anonymous at a large font scale", async () => {
    setFontScale(2);
    await render(<StatsStrip {...BASE} signedIn={false} />);
    expect(cellWidths()).toEqual(["50%", "50%"]);
  });

  it("shows a skeleton pill for server figures while they load; local ones render at once", async () => {
    await render(<StatsStrip {...BASE} comments={null} helpful={null} loading />);
    expect(screen.getByTestId("stat-comments-skeleton")).toBeTruthy();
    expect(screen.getByTestId("stat-helpful-skeleton")).toBeTruthy();
    expect(screen.getByLabelText("Reports: 12")).toBeTruthy();
    expect(screen.getByLabelText("Badges: 5/9")).toBeTruthy();
  });

  it("shows a dash for server figures that could not be read", async () => {
    await render(<StatsStrip {...BASE} comments={null} helpful={null} loading={false} />);
    expect(screen.getByLabelText("Comments: –")).toBeTruthy();
    expect(screen.queryByTestId("stat-comments-skeleton")).toBeNull();
  });

  it("localizes digits in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    await render(<StatsStrip {...BASE} />);
    expect(screen.getByLabelText("ڕاپۆرت: ١٢")).toBeTruthy();
    expect(screen.getByLabelText("نیشانەکان: ٥/٩")).toBeTruthy();
  });
});
