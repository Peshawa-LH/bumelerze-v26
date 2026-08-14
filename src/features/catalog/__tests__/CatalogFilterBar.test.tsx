import { fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { CatalogFilterBar, type CatalogFilterValues } from "../components/CatalogFilterBar";
import type { CatalogBounds } from "../types";

const BOUNDS: CatalogBounds = { magMin: 0, magMax: 8, yearMin: 900, yearMax: 2020 };

const BASE_VALUES: CatalogFilterValues = {
  magMin: 4,
  magMax: 6,
  yearMin: 1990,
  yearMax: 2010,
  sources: [],
};

describe("CatalogFilterBar", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    // No manual `cleanup()` call — @testing-library/react-native
    // auto-registers its own `afterEach(cleanup)` on import (see its
    // `index.js`), same convention `ShakeMapSection.test.tsx` relies on.
    await i18n.changeLanguage(originalLanguage);
  });

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("increments magMin by CATALOG_MAG_STEP on a single tap", async () => {
    const onChange = jest.fn();
    await render(<CatalogFilterBar bounds={BOUNDS} values={BASE_VALUES} onChange={onChange} />);

    const incrementButtons = screen.getAllByLabelText("Increase");
    // magMin's stepper is the first one rendered (magMin, magMax, yearMin, yearMax order).
    // `fireEvent` is itself async (wraps the handler call in `act()`) — every
    // call MUST be awaited, or two overlapping un-awaited `act()` calls
    // corrupt react-test-renderer's global act-nesting state and silently
    // break every subsequent test's render in the same file (discovered
    // the hard way building this suite).
    await fireEvent(incrementButtons[0] as never, "pressIn");
    await fireEvent(incrementButtons[0] as never, "pressOut");

    expect(onChange).toHaveBeenCalledWith({ ...BASE_VALUES, magMin: 4.5 });
  });

  it("decrements yearMax by CATALOG_YEAR_STEP on a single tap", async () => {
    const onChange = jest.fn();
    await render(<CatalogFilterBar bounds={BOUNDS} values={BASE_VALUES} onChange={onChange} />);

    const decrementButtons = screen.getAllByLabelText("Decrease");
    // Order: magMin, magMax, yearMin, yearMax -> yearMax's decrement is the 4th.
    await fireEvent(decrementButtons[3] as never, "pressIn");
    await fireEvent(decrementButtons[3] as never, "pressOut");

    expect(onChange).toHaveBeenCalledWith({ ...BASE_VALUES, yearMax: 2000 });
  });

  it("does not step magMin past magMax (min/max steppers stay ordered)", async () => {
    const onChange = jest.fn();
    const pinned: CatalogFilterValues = { ...BASE_VALUES, magMin: 6, magMax: 6 };
    await render(<CatalogFilterBar bounds={BOUNDS} values={pinned} onChange={onChange} />);

    const incrementButtons = screen.getAllByLabelText("Increase");
    await fireEvent(incrementButtons[0] as never, "pressIn"); // magMin's increment, disabled (value === max)
    await fireEvent(incrementButtons[0] as never, "pressOut");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggling a source chip adds it to an empty selection", async () => {
    const onChange = jest.fn();
    await render(<CatalogFilterBar bounds={BOUNDS} values={BASE_VALUES} onChange={onChange} />);

    await fireEvent.press(screen.getByLabelText("USGS"));

    expect(onChange).toHaveBeenCalledWith({ ...BASE_VALUES, sources: ["USGS"] });
  });

  it("toggling an already-selected source chip removes it", async () => {
    const onChange = jest.fn();
    const withSource: CatalogFilterValues = { ...BASE_VALUES, sources: ["USGS", "KISC"] };
    await render(<CatalogFilterBar bounds={BOUNDS} values={withSource} onChange={onChange} />);

    await fireEvent.press(screen.getByLabelText("USGS"));

    expect(onChange).toHaveBeenCalledWith({ ...withSource, sources: ["KISC"] });
  });

  it("renders the Bumelerze union chip FIRST, selected when no source filter applies", async () => {
    // "Bumelerze" = the full compiled view (the union, not a row subset —
    // types.ts CATALOG_UNION_CHIP): with the default empty selection it
    // reads as the selected chip.
    await render(<CatalogFilterBar bounds={BOUNDS} values={BASE_VALUES} onChange={jest.fn()} />);

    const chips = screen.getAllByRole("checkbox");
    expect(chips[0]!.props.accessibilityLabel).toBe("Bumelerze");
    expect(chips[0]!.props.accessibilityState.checked).toBe(true);
    // The five source chips follow, all unchecked.
    expect(chips).toHaveLength(6);
  });

  it("unselects the Bumelerze chip when a source subset is chosen", async () => {
    const withSource: CatalogFilterValues = { ...BASE_VALUES, sources: ["USGS"] };
    await render(<CatalogFilterBar bounds={BOUNDS} values={withSource} onChange={jest.fn()} />);

    expect(screen.getByLabelText("Bumelerze").props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText("USGS").props.accessibilityState.checked).toBe(true);
  });

  it("tapping the Bumelerze chip clears the source selection back to the union view", async () => {
    const onChange = jest.fn();
    const withSources: CatalogFilterValues = { ...BASE_VALUES, sources: ["USGS", "KISC"] };
    await render(<CatalogFilterBar bounds={BOUNDS} values={withSources} onChange={onChange} />);

    await fireEvent.press(screen.getByLabelText("Bumelerze"));

    expect(onChange).toHaveBeenCalledWith({ ...withSources, sources: [] });
  });

  it("renders the Bumelerze chip with its Sorani brand name under ckb", async () => {
    await i18n.changeLanguage("ckb");
    await render(<CatalogFilterBar bounds={BOUNDS} values={BASE_VALUES} onChange={jest.fn()} />);

    expect(screen.getByLabelText("بوومەلەرزە")).toBeTruthy();
  });

  it("reflects selection state via accessibilityState.checked", async () => {
    const withSource: CatalogFilterValues = { ...BASE_VALUES, sources: ["KISC"] };
    await render(<CatalogFilterBar bounds={BOUNDS} values={withSource} onChange={jest.fn()} />);

    expect(screen.getByLabelText("KISC").props.accessibilityState.checked).toBe(true);
    expect(screen.getByLabelText("USGS").props.accessibilityState.checked).toBe(false);
  });

  it("renders correctly under the Sorani (RTL) locale with localized digits", async () => {
    await i18n.changeLanguage("ckb");
    await render(<CatalogFilterBar bounds={BOUNDS} values={BASE_VALUES} onChange={jest.fn()} />);

    // Magnitude steppers show digit-localized one-decimal values (lib/
    // format-numbers.ts: ckb uses Eastern Arabic-Indic digits).
    expect(screen.getByText("٤.٠")).toBeTruthy(); // magMin = 4
    expect(screen.getByText("٦.٠")).toBeTruthy(); // magMax = 6
    // Year steppers show digit-localized integer years.
    expect(screen.getByText("١٩٩٠")).toBeTruthy(); // yearMin
    expect(screen.getByText("٢٠١٠")).toBeTruthy(); // yearMax
  });
});
