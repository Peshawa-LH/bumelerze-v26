import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import i18n from "@/i18n";
import { usePrefsStore } from "@/features/onboarding";

import { HomeBaseSection } from "../components/HomeBaseSection";

const mockGetPermission = jest.fn();
jest.mock("expo-location", () => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: () => mockGetPermission(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const ERBIL = { townId: "erbil", lat: 36.19, lon: 44.01 };

describe("HomeBaseSection (automatic HomeBase)", () => {
  beforeEach(async () => {
    mockGetPermission.mockResolvedValue({ status: "granted" });
    usePrefsStore.setState({
      hasHydrated: true,
      homeBase: ERBIL,
      homeBaseSource: "auto",
      homeBaseAutoCheckedAt: 1_700_000_000_000,
    });
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows one row: the city at the end, a mark and a spoken note that it was set automatically", async () => {
    await render(<HomeBaseSection />);
    expect(screen.getByText("HomeBase")).toBeTruthy();
    expect(screen.getByText("Hawler")).toBeTruthy();
    expect(
      screen.getByTestId("homebase-auto-mark", { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByTestId("homebase-row").props.accessibilityLabel).toBe(
      "HomeBase, Hawler, Set automatically",
    );
    expect(screen.queryByRole("button", { name: "Use my location again" })).toBeNull();
    expect(screen.queryByText("Change")).toBeNull();
  });

  it("shows the city in the reader's language", async () => {
    await i18n.changeLanguage("ckb");
    await render(<HomeBaseSection />);
    expect(screen.getByText("هەولێر")).toBeTruthy();
    expect(screen.getByTestId("homebase-row").props.accessibilityLabel).toBe(
      "بنکەی ماڵەوە, هەولێر, خۆکار",
    );
  });

  it("the town list opens on a tap of the row (and the row says it is expanded)", async () => {
    await render(<HomeBaseSection />);
    expect(screen.getByTestId("homebase-row").props.accessibilityState.expanded).toBe(
      false,
    );
    expect(screen.queryByText("Slemani")).toBeNull();
    await fireEvent.press(screen.getByTestId("homebase-row"));
    expect(screen.getByTestId("homebase-row").props.accessibilityState.expanded).toBe(
      true,
    );
    expect(await screen.findByText("Slemani")).toBeTruthy();
  });

  it("choosing a town by hand makes it manual and stops the 'set automatically' label", async () => {
    await render(<HomeBaseSection />);
    await fireEvent.press(screen.getByTestId("homebase-row"));
    await fireEvent.press(await screen.findByText("Slemani"));

    const state = usePrefsStore.getState();
    expect(state.homeBase?.townId).toBe("slemani");
    expect(state.homeBaseSource).toBe("manual");
    expect(
      screen.queryByTestId("homebase-auto-mark", { includeHiddenElements: true }),
    ).toBeNull();
    expect(screen.getByText("Slemani")).toBeTruthy();
  });

  it("offers 'Use my location again' for a manual choice when permission is granted, and goes back to auto", async () => {
    usePrefsStore.setState({ homeBaseSource: "manual" });
    await render(<HomeBaseSection />);
    const again = await screen.findByRole("button", { name: "Use my location again" });
    await fireEvent.press(again);

    const state = usePrefsStore.getState();
    expect(state.homeBaseSource).toBe("auto");
    expect(state.homeBaseAutoCheckedAt).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByTestId("homebase-auto-mark", { includeHiddenElements: true }),
      ).toBeTruthy(),
    );
  });

  it("keeps today's behaviour without location permission: plain town name, no auto option", async () => {
    mockGetPermission.mockResolvedValue({ status: "denied" });
    usePrefsStore.setState({ homeBaseSource: "manual" });
    await render(<HomeBaseSection />);
    expect(screen.getByText("Hawler")).toBeTruthy();
    await waitFor(() => expect(mockGetPermission).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Use my location again" })).toBeNull();
  });

  it("shows 'Not set' when no town is known yet", async () => {
    usePrefsStore.setState({ homeBase: null, homeBaseSource: "auto" });
    await render(<HomeBaseSection />);
    expect(screen.getByText("Not set")).toBeTruthy();
  });
});
