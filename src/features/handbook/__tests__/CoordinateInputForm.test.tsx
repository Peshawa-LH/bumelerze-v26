import { act, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { CoordinateInputForm } from "../components/CoordinateInputForm";

// Same "mock the data hook, test the presentational component" pattern
// `CatalogListScreen.test.tsx` uses for `useCatalogBounds`/`useCatalogList`.
jest.mock("@/features/location", () => ({
  useUserDistanceAnchor: jest.fn(),
}));

// The "Use my location" tap asks the platform itself (B-18) — the same
// `expo-location` surface `MyLocationRow.test.tsx` stubs.
const mockRequestPermission = jest.fn();
const mockGetLastKnown = jest.fn();
jest.mock("expo-location", () => ({
  PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" },
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: () => mockRequestPermission(),
  getLastKnownPositionAsync: () => mockGetLastKnown(),
  getCurrentPositionAsync: () => mockGetLastKnown(),
}));

// eslint-disable-next-line import/first -- imported after the mock above, see comment
import { useUserDistanceAnchor } from "@/features/location";

const mockedUseUserDistanceAnchor = useUserDistanceAnchor as jest.MockedFunction<
  typeof useUserDistanceAnchor
>;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("CoordinateInputForm", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockedUseUserDistanceAnchor.mockReturnValue({ hasFix: false, lat: null, lon: null });
    mockRequestPermission.mockReset();
    mockGetLastKnown.mockReset();
  });

  afterEach(async () => {
    mockedUseUserDistanceAnchor.mockReset();
    await i18n.changeLanguage(originalLanguage);
  });

  it("calls onSubmit with parsed numeric coordinates on valid input", async () => {
    const onSubmit = jest.fn();
    await render(<CoordinateInputForm onSubmit={onSubmit} />);

    await fireEvent.changeText(screen.getByLabelText("Latitude"), "35.56");
    await fireEvent.changeText(screen.getByLabelText("Longitude"), "45.43");
    await fireEvent.press(screen.getByText("Look up"));

    expect(onSubmit).toHaveBeenCalledWith(35.56, 45.43);
  });

  it("shows a field error and does not submit on an out-of-range latitude", async () => {
    const onSubmit = jest.fn();
    await render(<CoordinateInputForm onSubmit={onSubmit} />);

    await fireEvent.changeText(screen.getByLabelText("Latitude"), "120");
    await fireEvent.changeText(screen.getByLabelText("Longitude"), "45.43");
    await fireEvent.press(screen.getByText("Look up"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Out of range.")).toBeTruthy();
  });

  it("shows an empty-field error when submitted blank", async () => {
    const onSubmit = jest.fn();
    await render(<CoordinateInputForm onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByText("Look up"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText("Enter a value.").length).toBe(2);
  });

  it("keeps 'use my location' enabled with no fix and shows no note until a refusal (B-18)", async () => {
    await render(<CoordinateInputForm onSubmit={jest.fn()} />);

    expect(screen.queryByTestId("handbook-location-denied")).toBeNull();
    const button = screen.getByText("Use my location");
    expect(button.props.style.color).not.toBeUndefined();
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it("asks the platform for a fix when tapped and fills the fields on a grant", async () => {
    mockRequestPermission.mockResolvedValue({ granted: true, status: "granted" });
    mockGetLastKnown.mockResolvedValue({ coords: { latitude: 36.1911, longitude: 44.0091 } });
    const onSubmit = jest.fn();
    await render(<CoordinateInputForm onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByText("Use my location"));
    await flush();

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Latitude").props.value).toBe("36.1911");
    expect(screen.queryByTestId("handbook-location-denied")).toBeNull();
    await fireEvent.press(screen.getByText("Look up"));
    expect(onSubmit).toHaveBeenCalledWith(36.1911, 44.0091);
  });

  it("shows the note only after the platform refused", async () => {
    mockRequestPermission.mockResolvedValue({ granted: false, status: "denied" });
    await render(<CoordinateInputForm onSubmit={jest.fn()} />);

    await fireEvent.press(screen.getByText("Use my location"));
    await flush();

    expect(mockGetLastKnown).not.toHaveBeenCalled();
    expect(
      screen.getByText("Location isn't available. Turn on location access in Settings."),
    ).toBeTruthy();
  });

  it("uses an already-known fix without prompting", async () => {
    mockedUseUserDistanceAnchor.mockReturnValue({ hasFix: true, lat: 35.561, lon: 45.431 });
    const onSubmit = jest.fn();
    await render(<CoordinateInputForm onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByText("Use my location"));
    await fireEvent.press(screen.getByText("Look up"));

    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith(35.561, 45.431);
  });

  it("has no map-picker affordance under the default (native) platform resolution", async () => {
    // `MapCoordinatePicker` is a `.tsx`/`.web.tsx` platform split
    // (`components/MapCoordinatePicker.tsx`'s own doc comment: there is no
    // native MapLibre map yet) — this repo's jest-expo preset resolves the
    // plain, suffix-less import to the NATIVE file by default, same as a
    // real native build would, so this asserts the actual shipped native
    // behavior rather than a mock of it.
    await render(<CoordinateInputForm onSubmit={jest.fn()} />);

    expect(screen.queryByText("Pick on the map")).toBeNull();
    // Manual entry and the gazetteer town picker are unaffected.
    expect(screen.getByText("Pick a town instead")).toBeTruthy();
  });

  it("fills the fields from a picked gazetteer town", async () => {
    const onSubmit = jest.fn();
    await render(<CoordinateInputForm onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByText("Pick a town instead"));
    await fireEvent.press(screen.getByText("Hawler"));
    await fireEvent.press(screen.getByText("Look up"));

    expect(onSubmit).toHaveBeenCalledWith(36.19, 44.01);
  });

  it("fills the fields in the reader's own digits under Sorani and still submits numbers (B-7/B-16)", async () => {
    await i18n.changeLanguage("ckb");
    const onSubmit = jest.fn();
    await render(<CoordinateInputForm onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByText(i18n.t("handbook.coordinates.pickTown")));
    await fireEvent.press(screen.getByText("هەولێر"));

    const lat = screen.getByTestId("handbook-lat-input");
    expect(lat.props.value).toBe("٣٦.١٩٠٠");
    // The inputs follow the app language's direction, like their labels.
    const style = Object.assign({}, ...[lat.props.style].flat());
    expect(style.writingDirection).toBe("rtl");
    expect(style.textAlign).toBe("right");

    await fireEvent.press(screen.getByText(i18n.t("handbook.lookupButton")));
    expect(onSubmit).toHaveBeenCalledWith(36.19, 44.01);
  });
});
