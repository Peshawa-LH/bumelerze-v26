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

// The real Ionicons host drops its `name` prop once rendered (it resolves
// to a font glyph `children` string that itself renders empty under jest's
// font resolution) — stubbing to a plain `Text` that echoes `name` as text
// content is the only reliable way to assert the catalog-link chevron's
// LTR-vs-RTL mirroring (same technique as `HeaderBackButton.test.tsx`).
jest.mock("@expo/vector-icons", () => {
  const { createElement } = jest.requireActual("react");
  const { Text } = jest.requireActual("react-native");
  return {
    Ionicons: ({ name, testID }: { name: string; testID?: string }) =>
      createElement(Text, { testID }, name),
  };
});

// Imported after the mocks above so the mocked module graph is in place.
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
    // compile-time constant — this screen never shows a spinner). Filtered
    // to rows carrying an explicit `accessibilityLabel` (every
    // `HistoricalEventRow` sets one — year+magnitude+place+note) to
    // exclude the screen's own "full catalog" footer link, which is also
    // `accessibilityRole="button"` but relies on its Text child for its
    // accessible name instead (regional-catalog wave entry point).
    const rows = screen
      .getAllByRole("button")
      .filter((row) => Boolean(row.props.accessibilityLabel));
    expect(rows).toHaveLength(NOTABLE_HISTORICAL_EVENTS.length);

    // Newest-first ordering: the first rendered row is the 2023 Elbistan
    // event (later of the same-day Kahramanmaraş doublet), the last is the
    // oldest (1944 Al-Hamdaniya).
    const newestFirst = sortNewestFirst(NOTABLE_HISTORICAL_EVENTS);
    expect(newestFirst[0]?.id).toBe("us6000jlqa");
    expect(newestFirst.at(-1)?.id).toBe("iscgem899464");
    expect(rows[0]?.props.accessibilityLabel).toEqual(expect.stringContaining("٢٠٢٣"));
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
      screen.getByText("بوومەلەرزەیەکی مامناوەند لە نزیک عەقرە، لە پارێزگای دهۆک."),
    ).toBeTruthy();
  });

  it("shows a header with a back control (owner: pushed screens need a way back)", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<HistoricalScreen />);

    expect(mockScreenOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        headerShown: true,
        headerLeft: expect.any(Function),
      }),
    );
  });

  it("still opens /catalog from the footer link, now the only in-app path to it", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<HistoricalScreen />);

    fireEvent.press(screen.getByText("See the full catalog"));

    expect(mockPush).toHaveBeenCalledWith("/catalog");
  });

  it("points the catalog link's chevron forward (toward reading-end) in English", async () => {
    expect(isRTLLocale("en")).toBe(false);
    await i18n.changeLanguage("en");
    await renderWithProviders(<HistoricalScreen />);

    expect(
      screen.getByTestId("historical-catalog-link-chevron").props.children,
    ).toBe("chevron-forward");
  });

  it("mirrors the catalog link's chevron for the Sorani (RTL) locale", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");
    await renderWithProviders(<HistoricalScreen />);

    expect(
      screen.getByTestId("historical-catalog-link-chevron").props.children,
    ).toBe("chevron-back");
  });

  it("navigates to /event/[id] on row tap using the Bumelerze id, not the provider id (owner directive 2026-09-02)", async () => {
    await i18n.changeLanguage("en");
    await renderWithProviders(<HistoricalScreen />);

    // Halabja/Sarpol-e Zahab 2017 row — its accessible name starts with the
    // year, which we can locate via its full a11y label built from
    // year+magnitude+place+note.
    const halabjaLabel = screen.getByLabelText(/2017\. M 7\.3/);
    fireEvent.press(halabjaLabel);

    // bml20170001, not the USGS id (us2000bmcg) — see notable-events.ts's
    // verified mapping.
    expect(mockPush).toHaveBeenCalledWith("/event/bml20170001");
  });

  it("renders a sample historical event's Sorani name (update-plan-2026-08.md §1.4)", async () => {
    await i18n.changeLanguage("ckb");
    await renderWithProviders(<HistoricalScreen />);

    // The 1991 Akre event's localized Sorani name, sourced from
    // historical.eventNames.aqrah1991 — not the raw English "Akre
    // earthquake" the owner flagged.
    expect(screen.getByText("بوومەلەرزەی ١٩٩١ لە ئاکرێ")).toBeTruthy();
  });

  it.each(["ckb", "kmr", "ar"] as const)(
    "shows no English fallback string on the Historical screen in %s (update-plan-2026-08.md §1.4)",
    async (locale) => {
      await i18n.changeLanguage(locale);
      await renderWithProviders(<HistoricalScreen />);

      // The two Kahramanmaraş events are the only ones whose place text
      // falls outside the gazetteer's fallback radius — before this fix
      // they leaked the raw English `placeName` ("Pazarcık, Kahramanmaraş,
      // Türkiye" / "Elbistan, Kahramanmaraş, Türkiye"). Neither the English
      // event-name strings nor the raw English place strings should render
      // in a non-English locale.
      expect(screen.queryByText("Pazarcık, Kahramanmaraş, Türkiye")).toBeNull();
      expect(screen.queryByText("Elbistan, Kahramanmaraş, Türkiye")).toBeNull();
      expect(screen.queryByText("2023 Pazarcık earthquake")).toBeNull();
      expect(screen.queryByText("2023 Elbistan earthquake")).toBeNull();
      expect(screen.queryByText("1991 Akre earthquake")).toBeNull();
    },
  );
});
