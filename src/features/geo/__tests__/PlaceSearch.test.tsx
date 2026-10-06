import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import i18n, { isRTLLocale } from "@/i18n";
import { PlaceSearch } from "../components/PlaceSearch";
import { __resetPlaceIndexForTests, loadPlaceIndex } from "../place-index";

const mockGetPermissions = jest.fn();
const mockGetLastKnown = jest.fn();
jest.mock("expo-location", () => ({
  PermissionStatus: { GRANTED: "granted", DENIED: "denied" },
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: () => mockGetPermissions(),
  getLastKnownPositionAsync: () => mockGetLastKnown(),
  getCurrentPositionAsync: () => mockGetLastKnown(),
}));

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderSearch(props: Partial<Parameters<typeof PlaceSearch>[0]> = {}) {
  const onSelect = jest.fn();
  await render(<PlaceSearch onSelect={onSelect} {...props} />);
  await flush();
  return onSelect;
}

describe("PlaceSearch", () => {
  const originalLanguage = i18n.language;

  beforeAll(async () => {
    await loadPlaceIndex();
  });

  beforeEach(() => {
    mockGetPermissions.mockResolvedValue({ status: "denied" });
    mockGetLastKnown.mockResolvedValue(null);
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("offers the main towns as quick picks when there is no location fix", async () => {
    await renderSearch();
    expect(screen.getByText("Main towns")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(18);
    expect(screen.getByText("Hawler")).toBeTruthy();
    expect(screen.getAllByText("Kurdistan (Iraq)").length).toBeGreaterThan(0);
  });

  it("offers the nearest towns first when there is a fix", async () => {
    mockGetPermissions.mockResolvedValue({ status: "granted" });
    // Right next to Slemani.
    mockGetLastKnown.mockResolvedValue({ coords: { latitude: 35.56, longitude: 45.43 } });
    await renderSearch();
    expect(screen.getByText("Nearby")).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(5);
    expect(buttons[0]?.props.accessibilityLabel).toContain("Slemani");
  });

  it("finds a place typed in another script and reports the pick", async () => {
    const onSelect = await renderSearch();
    await fireEvent.changeText(screen.getByLabelText("Search for a place"), "هەولێر");
    const result = screen.getByTestId("place-search-result-erbil");
    expect(screen.queryByText("Main towns")).toBeNull();
    // English UI: the English name (Hawler), whatever script was typed.
    expect(screen.getByText("Hawler")).toBeTruthy();
    await fireEvent.press(result);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "erbil" }));
  });

  it("shows a village with a quiet 'near' line and a full accessibility label", async () => {
    await renderSearch();
    await fireEvent.changeText(screen.getByLabelText("Search for a place"), "Sehbiyax");
    const row = screen.getByTestId("place-search-result-n9852690211");
    expect(row.props.accessibilityLabel).toMatch(/Şehbîyax.*Near .*/);
    expect(row.props.accessibilityRole).toBe("button");
    const styles = Array.isArray(row.props.style)
      ? row.props.style.flat()
      : [row.props.style];
    expect(
      Math.max(...styles.map((style: { minHeight?: number }) => style?.minHeight ?? 0)),
    ).toBeGreaterThanOrEqual(44);
  });

  it("says so when nothing matches, and clears back to the quick picks", async () => {
    await renderSearch();
    await fireEvent.changeText(screen.getByLabelText("Search for a place"), "zzzzqqqq");
    expect(screen.getByText("No place found")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Main towns")).toBeTruthy();
  });

  it("marks the selected place", async () => {
    await renderSearch({ selectedPlaceId: "slemani" });
    expect(
      screen.getByTestId("place-search-result-slemani").props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
    expect(
      screen.getByTestId("place-search-result-erbil").props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: false }));
  });

  it("works in Sorani (RTL): Sorani names, Sorani labels, region in Sorani", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");
    __resetPlaceIndexForTests();
    await loadPlaceIndex();
    await renderSearch();
    expect(screen.getByText("شارە سەرەکییەکان")).toBeTruthy();
    expect(screen.getByText("هەولێر")).toBeTruthy();
    expect(screen.getAllByText("کوردستان (عێراق)").length).toBeGreaterThan(0);
    await fireEvent.changeText(screen.getByLabelText("گەڕان بۆ شوێنێک"), "hewler");
    const row = screen.getByTestId("place-search-result-erbil");
    expect(row.props.accessibilityLabel).toContain("هەولێر");
    await fireEvent.changeText(screen.getByLabelText("گەڕان بۆ شوێنێک"), "zzzzqqqq");
    expect(screen.getByText("هیچ شوێنێک نەدۆزرایەوە")).toBeTruthy();
  });

  it("falls back to another language's name when the UI language has none", async () => {
    await i18n.changeLanguage("ckb");
    await renderSearch();
    // This village has only a Kurmanji name: a Sorani reader still sees it.
    await fireEvent.changeText(screen.getByLabelText("گەڕان بۆ شوێنێک"), "Belawe Hoske");
    expect(screen.getByText("Belawe Hoşke")).toBeTruthy();
  });
});
