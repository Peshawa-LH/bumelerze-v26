import { fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";

import NotFoundScreen from "../+not-found";

/**
 * Review B-1: an unknown address used to show Expo Router's stock English
 * "Unmatched Route" page with the raw URL and a sitemap link. The app's own
 * page is in the app's language and has one way out, Home.
 */
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe("+not-found", () => {
  afterEach(async () => {
    mockReplace.mockReset();
    await i18n.changeLanguage("en");
  });

  it("says the page was not found and offers Home, without showing the address", async () => {
    await render(<NotFoundScreen />);
    expect(screen.getByRole("header").props.children).toBe("Page not found");
    expect(screen.getByText("This page does not exist or has moved.")).toBeTruthy();
    expect(screen.queryByText(/sitemap/i)).toBeNull();
    expect(screen.queryByText(/\//)).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Go to Home" }));
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it.each(["ckb", "kmr", "ar"])("is translated in %s", async (locale) => {
    await i18n.changeLanguage(locale);
    await render(<NotFoundScreen />);
    expect(screen.getByRole("header").props.children).toBe(i18n.t("nav.notFoundTitle"));
    expect(i18n.t("nav.notFoundTitle")).not.toBe("Page not found");
  });
});
