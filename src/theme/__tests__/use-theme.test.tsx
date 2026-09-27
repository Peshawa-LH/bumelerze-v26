import { renderHook } from "@testing-library/react-native";

import { useThemePreferencesStore } from "../preferences-store";
import { useTheme } from "../use-theme";

// Mock only the hook's implementation module (not the whole `react-native`
// package, which pulls in dev-only native specs that don't exist in the
// Jest environment) so `useColorScheme()` reports "dark" for this test.
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => "dark",
}));

// The two "explicit preference" tests below set the store's state directly
// before rendering, and no test after them relies on the store's default —
// so unlike `preferences-store.test.ts` (which exercises the store on its
// own, with no React subscriber), there is no need for a per-test
// `resetModules`/`act` reset dance here: only render order matters, and the
// tests that need the "auto" default run first.
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

  it("resolves the system scheme when the preference is 'auto' (the default)", async () => {
    const { result } = await renderHook(() => useTheme());

    // The mocked `useColorScheme()` above reports "dark", and the store's
    // default preference is "auto" — the owner's "follows the system".
    expect(result.current.scheme).toBe("dark");
  });

  it("resolves dark when the preference is 'dark', regardless of the system scheme", async () => {
    useThemePreferencesStore.getState().setPreference("dark");
    const { result } = await renderHook(() => useTheme());

    expect(result.current.scheme).toBe("dark");
  });

  it("resolves light when the preference is 'light', overriding a dark system scheme", async () => {
    useThemePreferencesStore.getState().setPreference("light");
    const { result } = await renderHook(() => useTheme());

    // The mocked system scheme is "dark" — an explicit "light" choice must
    // still win.
    expect(result.current.scheme).toBe("light");
    expect(result.current.colors.surface.base).not.toBe("#000000");
  });
});
