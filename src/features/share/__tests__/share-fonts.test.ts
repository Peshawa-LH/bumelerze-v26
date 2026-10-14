import * as Font from "expo-font";
import { Platform } from "react-native";

import { ensureShareFontsLoaded } from "../share-fonts";

/**
 * Review A-2/B-2: in English and Kurmanji the web never registered
 * Vazirmatn, so the on-screen share card (hub slide 1, the sheet's preview)
 * fell back to a serif face. The card now fetches its two faces itself, once.
 */
jest.mock("expo-font", () => ({
  isLoaded: jest.fn(() => false),
  loadAsync: jest.fn(() => Promise.resolve()),
}));

const isLoaded = Font.isLoaded as jest.Mock;
const loadAsync = Font.loadAsync as jest.Mock;
const originalOS = Platform.OS;
function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
}

beforeEach(() => {
  jest.clearAllMocks();
  isLoaded.mockReturnValue(false);
});
afterEach(() => setOS(originalOS));

describe("ensureShareFontsLoaded", () => {
  it("web: registers Vazirmatn-Regular and -Bold, once for any number of cards", async () => {
    setOS("web");
    await Promise.all([ensureShareFontsLoaded(), ensureShareFontsLoaded()]);
    expect(loadAsync).toHaveBeenCalledTimes(1);
    const faces = loadAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(faces).sort()).toEqual(["Vazirmatn-Bold", "Vazirmatn-Regular"]);
  });

  it("web: does nothing when both faces are already registered (Sorani, Arabic)", async () => {
    setOS("web");
    isLoaded.mockReturnValue(true);
    await ensureShareFontsLoaded();
    expect(loadAsync).not.toHaveBeenCalled();
  });

  it("phone: nothing to do, the faces come with the app", async () => {
    setOS("ios");
    await ensureShareFontsLoaded();
    expect(loadAsync).not.toHaveBeenCalled();
  });
});
