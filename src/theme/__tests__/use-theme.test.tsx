import { renderHook } from "@testing-library/react-native";

import { useTheme } from "../use-theme";

// Mock only the hook's implementation module (not the whole `react-native`
// package, which pulls in dev-only native specs that don't exist in the
// Jest environment) so `useColorScheme()` reports "dark" for this test.
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => "dark",
}));

describe("useTheme", () => {
  it("returns true-black-leaning dark tokens when the system scheme is dark", async () => {
    const { result } = await renderHook(() => useTheme());

    expect(result.current.scheme).toBe("dark");
    // design-language.md §4: dark surfaces are true-black-leaning, not the
    // "dark gray card" pattern.
    expect(result.current.colors.surface.base).toBe("#000000");
    expect(result.current.colors.text.primary).not.toBe(
      result.current.colors.surface.base,
    );
  });
});
