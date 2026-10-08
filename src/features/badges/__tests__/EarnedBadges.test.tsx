import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

import { EarnedBadges } from "../components/EarnedBadges";
import { BadgeGrid } from "../components/BadgeGrid";
import { EMPTY_BADGE_INPUTS, evaluateBadges } from "../evaluate";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const ALL = evaluateBadges({ ...EMPTY_BADGE_INPUTS, reports: 2, comments: 1 }, [], {
  includeRequestableRanks: true,
});
const EARNED = ALL.filter((entry) => entry.earned);

function renderBadges(ui: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

describe("EarnedBadges", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(async () => {
    await cleanup();
    await i18n.changeLanguage("en");
  });

  it("a visitor sees the earned badges and no 'See all' link", async () => {
    await renderBadges(<EarnedBadges entries={EARNED} />);
    expect(screen.getByLabelText("First report, earned")).toBeTruthy();
    expect(screen.getByLabelText("First comment, earned")).toBeTruthy();
    expect(screen.queryByTestId("badges-see-all")).toBeNull();
    expect(screen.queryByLabelText(/locked/)).toBeNull();
  });

  it("a visitor to a person with no earned badges sees no Badges block at all", async () => {
    await renderBadges(<EarnedBadges entries={[]} />);
    expect(screen.queryByTestId("profile-badges")).toBeNull();
  });

  it("the owner gets 'See all (N)' with the size of the full collection, opening /badges", async () => {
    await renderBadges(<EarnedBadges entries={EARNED} seeAllCount={ALL.length} />);
    expect(screen.getByText(`See all (${ALL.length})`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("badges-see-all"));
    expect(mockPush).toHaveBeenCalledWith("/badges");
  });

  it("the owner with nothing earned yet sees a friendly line and still the link", async () => {
    await renderBadges(<EarnedBadges entries={[]} seeAllCount={ALL.length} />);
    expect(screen.getByText("No badges earned yet.")).toBeTruthy();
    expect(screen.getByTestId("badges-see-all")).toBeTruthy();
  });

  it("localizes the link's number (Sorani)", async () => {
    await i18n.changeLanguage("ckb");
    await renderBadges(<EarnedBadges entries={EARNED} seeAllCount={13} />);
    expect(screen.getByText("هەمووی ببینە (١٣)")).toBeTruthy();
  });
});

describe("BadgeGrid defaultExpanded", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);
  it("starts with the whole collection showing when asked", async () => {
    await renderBadges(<BadgeGrid entries={ALL} defaultExpanded />);
    expect(screen.getByText("Show less")).toBeTruthy();
    expect(screen.getByLabelText("Engineer, locked")).toBeTruthy();
  });
});
