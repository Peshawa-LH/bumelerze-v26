import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";

import i18n, { isRTLLocale } from "@/i18n";

// `HeaderBackButton` calls `useRouter()` and `useNavigation()` directly (it's
// rendered as a pushed screen's `headerLeft`, never inside a real navigator
// during a unit test) — controllable mocks let each test drive
// `canGoBack()`, the stack state beneath, and assert on which of
// `back`/`replace`/`dismissTo` gets called.
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockCanGoBack = jest.fn();
const mockGetState = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    dismissTo: mockDismissTo,
    canGoBack: mockCanGoBack,
  }),
  useNavigation: () => ({ getState: mockGetState }),
}));

// The real Ionicons host component drops the `name` prop entirely once
// rendered (it resolves to a font glyph `children` string, which itself
// renders empty under jest's font resolution) — there is no way to query
// "which icon rendered" through the real component. Stubbing it to a plain
// `Text` that echoes `name` as its own text content is the only reliable way
// to assert the LTR-vs-RTL chevron choice `HeaderBackButton` makes.
jest.mock("@expo/vector-icons/Ionicons", () => {
  const { createElement } = jest.requireActual("react");
  const { Text } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: ({ name, testID }: { name: string; testID?: string }) =>
      createElement(Text, { testID }, name),
  };
});

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import { HeaderBackButton, isSeededHomeAnchorBeneath } from "../HeaderBackButton";

function renderWithProviders(ui: ReactElement) {
  return render(ui);
}

/** A (home) stack as expo-router builds it for in-app navigation: Home,
 * then the pushed screen. The anchor carries no params. */
const IN_APP_STACK = {
  index: 1,
  routes: [{ name: "index", params: {} }, { name: "event/[id]", params: { id: "bml20170001" } }],
};

/** The same stack after a COLD deep link to `/event/bml20170001`: expo-router
 * seeds the anchor `index` beneath the deep route WITH that route's params
 * (`getStateFromPath`'s `createStateObject`), which is what made Back land on
 * `/?id=bml20170001` (B-11). */
const DEEP_LINK_STACK = {
  index: 1,
  routes: [
    { name: "index", params: { id: "bml20170001" } },
    { name: "event/[id]", params: { id: "bml20170001" } },
  ],
};

describe("HeaderBackButton", () => {
  const originalLanguage = i18n.language;

  beforeEach(() => {
    mockBack.mockClear();
    mockReplace.mockClear();
    mockDismissTo.mockClear();
    mockCanGoBack.mockReset();
    mockGetState.mockReset();
    mockGetState.mockReturnValue(IN_APP_STACK);
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("goes back when there is history to go back to", async () => {
    mockCanGoBack.mockReturnValue(true);
    await renderWithProviders(<HeaderBackButton />);

    fireEvent.press(screen.getByRole("button"));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it("falls back to Home when there is no history (deep-link entry)", async () => {
    mockCanGoBack.mockReturnValue(false);
    await renderWithProviders(<HeaderBackButton />);

    fireEvent.press(screen.getByRole("button"));

    expect(mockReplace).toHaveBeenCalledWith("/");
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("[regression B-11] pops to a clean Home instead of the deep-link-seeded anchor that carries this screen's params", async () => {
    mockCanGoBack.mockReturnValue(true);
    mockGetState.mockReturnValue(DEEP_LINK_STACK);
    await renderWithProviders(<HeaderBackButton />);

    fireEvent.press(screen.getByRole("button"));

    // `dismissTo("/")` is a POP_TO with the href's own (empty) params, so the
    // URL becomes "/" rather than "/?id=bml20170001".
    expect(mockDismissTo).toHaveBeenCalledWith("/");
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("still goes back normally when the route beneath is not the Home anchor", async () => {
    mockCanGoBack.mockReturnValue(true);
    mockGetState.mockReturnValue({
      index: 2,
      routes: [
        { name: "index", params: {} },
        { name: "world", params: {} },
        { name: "event/[id]", params: { id: "bml20170001" } },
      ],
    });
    await renderWithProviders(<HeaderBackButton />);

    fireEvent.press(screen.getByRole("button"));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it("survives a navigator that reports no state", async () => {
    mockCanGoBack.mockReturnValue(true);
    mockGetState.mockReturnValue(undefined);
    await renderWithProviders(<HeaderBackButton />);

    fireEvent.press(screen.getByRole("button"));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("carries a translated, non-empty accessibility label", async () => {
    mockCanGoBack.mockReturnValue(true);
    await i18n.changeLanguage("en");
    await renderWithProviders(<HeaderBackButton />);

    const button = screen.getByRole("button");
    expect(button.props.accessibilityLabel).toBe("Back");
  });

  it.each(["ckb", "kmr", "ar", "en"] as const)(
    "carries a translated accessibility label in %s",
    async (locale) => {
      mockCanGoBack.mockReturnValue(true);
      await i18n.changeLanguage(locale);
      await renderWithProviders(<HeaderBackButton />);

      const button = screen.getByRole("button");
      expect(button.props.accessibilityLabel).toBe(i18n.t("nav.back"));
      expect(button.props.accessibilityLabel.length).toBeGreaterThan(0);
    },
  );

  it("points the chevron backward (start-of-reading-direction) in LTR locales", async () => {
    expect(isRTLLocale("en")).toBe(false);
    mockCanGoBack.mockReturnValue(true);
    await i18n.changeLanguage("en");
    await renderWithProviders(<HeaderBackButton />);

    expect(screen.getByTestId("header-back-chevron").props.children).toBe("chevron-back");
  });

  it("mirrors the chevron for RTL locales (Sorani)", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    mockCanGoBack.mockReturnValue(true);
    await i18n.changeLanguage("ckb");
    await renderWithProviders(<HeaderBackButton />);

    expect(screen.getByTestId("header-back-chevron").props.children).toBe("chevron-forward");
  });

  it("mirrors the chevron for RTL locales (Arabic)", async () => {
    expect(isRTLLocale("ar")).toBe(true);
    mockCanGoBack.mockReturnValue(true);
    await i18n.changeLanguage("ar");
    await renderWithProviders(<HeaderBackButton />);

    expect(screen.getByTestId("header-back-chevron").props.children).toBe("chevron-forward");
  });
});

describe("isSeededHomeAnchorBeneath", () => {
  it("recognises only an anchor `index` that carries params", () => {
    expect(isSeededHomeAnchorBeneath(DEEP_LINK_STACK)).toBe(true);
    expect(isSeededHomeAnchorBeneath(IN_APP_STACK)).toBe(false);
    expect(
      isSeededHomeAnchorBeneath({ index: 1, routes: [{ name: "index" }, { name: "world" }] }),
    ).toBe(false);
    expect(
      isSeededHomeAnchorBeneath({
        index: 1,
        routes: [{ name: "profile", params: { username: "x" } }, { name: "u/[username]" }],
      }),
    ).toBe(false);
    expect(isSeededHomeAnchorBeneath({ index: 0, routes: [{ name: "index", params: { id: "x" } }] })).toBe(false);
    expect(isSeededHomeAnchorBeneath(undefined)).toBe(false);
  });
});
