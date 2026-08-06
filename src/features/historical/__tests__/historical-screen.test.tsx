import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n, { isRTLLocale } from "@/i18n";
import { NOTABLE_HISTORICAL_EVENTS, sortNewestFirst } from "../notable-events";

// app/historical.tsx calls `useRouter()` directly (pushed screen, like
// world.tsx/significant.tsx) — a stable no-op mock, same pattern as
// home-screen.test.tsx. `Stack.Screen` is also mocked out: the real one
// calls `useRoute()` internally, which throws outside a real navigator —
// this screen doesn't need a real navigation tree for a render test, only a
// stand-in that records the `options` it was given (native header title —
// not part of the JS render tree, so we assert on the captured prop instead
// of `getByText`).
const mockPush = jest.fn();
const mockScreenOptions = jest.fn();
jest.mock("expo-router", () => {
  const actual = jest.requireActual("expo-router");
  return {
    ...actual,
    useRouter: () => ({ push: mockPush }),
    Stack: Object.assign(() => null, {
      ...actual.Stack,
      Screen: (props: { options?: { title?: string } }) => {
        mockScreenOptions(props.options);
        return null;
      },
    }),
  };
});

// Imported after the mock above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import HistoricalScreen from "../../../../app/historical";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

describe("Historical View (lite) under the Sorani (RTL) locale", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    cleanup();
    mockPush.mockClear();
    mockScreenOptions.mockClear();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders every bundled event, newest first, with no loading state (fully offline-tolerant)", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");

    await renderWithProviders(<HistoricalScreen />);

    // Native header title, in Sorani.
    expect(mockScreenOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: "ڕووداوە مێژووییەکان" }),
    );

    // One row per bundled event, no loading/empty state (the dataset is a
    // compile-time constant — this screen never shows a spinner).
    const rows = screen.getAllByRole("button");
    expect(rows).toHaveLength(NOTABLE_HISTORICAL_EVENTS.length);

    // Newest-first ordering: the first rendered row is the 2023 Elbistan
    // event (later of the same-day Kahramanmaraş doublet), the last is the
    // oldest (1944 Al-Hamdaniya).
    const newestFirst = sortNewestFirst(NOTABLE_HISTORICAL_EVENTS);
    expect(newestFirst[0]?.id).toBe("us6000jlqa");
    expect(newestFirst.at(-1)?.id).toBe("iscgem899464");
    expect(rows[0]?.props.accessibilityLabel).toEqual(
      expect.stringContaining("٢٠٢٣"),
    );
    expect(rows.at(-1)?.props.accessibilityLabel).toEqual(
      expect.stringContaining("١٩٤٤"),
    );

    // Halabja's note line renders somewhere on screen (factual, no drama —
    // trust principle), proving noteKey -> catalog resolution works live.
    expect(
      screen.getByText(
        "گەورەترین بوومەلەرزەی تۆمارکراو بە ئامێر لەسەر سنووری عێراق و ئێران لە مێژووی نوێدا، کە لە سەرتاسەری کوردستان هەستپێکرا.",
      ),
    ).toBeTruthy();

    // Spot-check one row's full localized text (year, magnitude, gazetteer
    // place line, note) to prove the row composes every field correctly,
    // not just that some text exists somewhere.
    expect(
      screen.getByText(
        "بوومەلەرزەیەکی مامناوەند لە نزیک عەقرە، لە پارێزگای دهۆک.",
      ),
    ).toBeTruthy();
  });

  it("navigates to /event/[id] on row tap (mocked router)", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<HistoricalScreen />);

    // Halabja/Sarpol-e Zahab 2017 row — its accessible name starts with the
    // year, which we can locate via its full a11y label built from
    // year+magnitude+place+note.
    const halabjaLabel = screen.getByLabelText(/2017\. M 7\.3/);
    fireEvent.press(halabjaLabel);

    expect(mockPush).toHaveBeenCalledWith("/event/us2000bmcg");
  });
});
