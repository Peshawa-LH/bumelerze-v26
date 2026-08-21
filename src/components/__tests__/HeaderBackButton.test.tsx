import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";

import i18n, { isRTLLocale } from "@/i18n";

// `HeaderBackButton` calls `useRouter()` directly (it's rendered as a
// pushed screen's `headerLeft`, never inside a real navigator during a unit
// test) — a controllable mock lets each test drive `canGoBack()` and assert
// on which of `back`/`replace` gets called.
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
}));

// The real Ionicons host component drops the `name` prop entirely once
// rendered (it resolves to a font glyph `children` string, which itself
// renders empty under jest's font resolution) — there is no way to query
// "which icon rendered" through the real component. Stubbing it to a plain
// `Text` that echoes `name` as its own text content is the only reliable way
// to assert the LTR-vs-RTL chevron choice `HeaderBackButton` makes.
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
import { HeaderBackButton } from "../HeaderBackButton";

function renderWithProviders(ui: ReactElement) {
  return render(ui);
}

describe("HeaderBackButton", () => {
  const originalLanguage = i18n.language;

  beforeEach(() => {
    mockBack.mockClear();
    mockReplace.mockClear();
    mockCanGoBack.mockReset();
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
  });

  it("falls back to Home when there is no history (deep-link entry)", async () => {
    mockCanGoBack.mockReturnValue(false);
    await renderWithProviders(<HeaderBackButton />);

    fireEvent.press(screen.getByRole("button"));

    expect(mockReplace).toHaveBeenCalledWith("/");
    expect(mockBack).not.toHaveBeenCalled();
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
