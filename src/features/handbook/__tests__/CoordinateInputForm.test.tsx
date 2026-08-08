import { fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { CoordinateInputForm } from "../components/CoordinateInputForm";

// Same "mock the data hook, test the presentational component" pattern
// `CatalogListScreen.test.tsx` uses for `useCatalogBounds`/`useCatalogList` —
// no real expo-location native module needed in Jest.
jest.mock("@/features/location", () => ({
  useUserDistanceAnchor: jest.fn(),
}));

// eslint-disable-next-line import/first -- imported after the mock above, see comment
import { useUserDistanceAnchor } from "@/features/location";

const mockedUseUserDistanceAnchor = useUserDistanceAnchor as jest.MockedFunction<
  typeof useUserDistanceAnchor
>;

describe("CoordinateInputForm", () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockedUseUserDistanceAnchor.mockReturnValue({ hasFix: false, lat: null, lon: null });
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

  it("disables 'use my location' and shows a hint when no fix is available", async () => {
    await render(<CoordinateInputForm onSubmit={jest.fn()} />);

    expect(
      screen.getByText("Location isn't available. Turn on location access in Settings."),
    ).toBeTruthy();
  });

  it("fills the fields from the location anchor when a fix is available", async () => {
    mockedUseUserDistanceAnchor.mockReturnValue({ hasFix: true, lat: 35.561, lon: 45.431 });
    const onSubmit = jest.fn();
    await render(<CoordinateInputForm onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByText("Use my location"));
    await fireEvent.press(screen.getByText("Look up"));

    expect(onSubmit).toHaveBeenCalledWith(35.561, 45.431);
  });

  it("fills the fields from a picked gazetteer town", async () => {
    const onSubmit = jest.fn();
    await render(<CoordinateInputForm onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByText("Pick a town instead"));
    await fireEvent.press(screen.getByText("Erbil"));
    await fireEvent.press(screen.getByText("Look up"));

    expect(onSubmit).toHaveBeenCalledWith(36.19, 44.01);
  });
});
