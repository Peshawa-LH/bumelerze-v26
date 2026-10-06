import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";

import { loadPlaceIndex } from "@/features/geo/place-index";
import { usePrefsStore } from "@/features/onboarding";
import i18n from "@/i18n";
import { MyLocationRow } from "../components/MyLocationRow";

/**
 * "My location" row on My account: three value states (auto with location,
 * auto without, manual) in English and Sorani, the inline "Use my location"
 * and place search, and the refusal path.
 */

const mockGetPermission = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetLastKnown = jest.fn();
jest.mock("expo-location", () => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: () => mockGetPermission(),
  requestForegroundPermissionsAsync: () => mockRequestPermission(),
  getLastKnownPositionAsync: () => mockGetLastKnown(),
  getCurrentPositionAsync: () => mockGetLastKnown(),
}));

const ERBIL = { placeId: "erbil", lat: 36.19, lon: 44.01 };
const DUHOK = { placeId: "duhok", lat: 36.87, lon: 42.99 };
const ISOLATE_OPEN = "⁨";
const ISOLATE_CLOSE = "⁩";

function isolated(name: string): string {
  return `${ISOLATE_OPEN}${name}${ISOLATE_CLOSE}`;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderRow() {
  await render(<MyLocationRow />);
  await flush();
}

async function openRow() {
  await act(async () => {
    fireEvent.press(screen.getByTestId("account-location-row"));
  });
  await flush();
}

function setPrefs(overrides: Partial<ReturnType<typeof usePrefsStore.getState>>) {
  usePrefsStore.setState({
    hasHydrated: true,
    referencePlace: ERBIL,
    referenceSource: "auto",
    referenceCheckedAt: null,
    ...overrides,
  });
}

describe("MyLocationRow", () => {
  const originalLanguage = i18n.language;

  beforeAll(async () => {
    await loadPlaceIndex();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetPermission.mockResolvedValue({ status: "granted" });
    mockRequestPermission.mockResolvedValue({ status: "granted", granted: true });
    mockGetLastKnown.mockResolvedValue({ coords: { latitude: 36.2, longitude: 44.0 } });
    setPrefs({});
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  describe("value line", () => {
    it("auto with location: 'Near {place}', never coordinates", async () => {
      setPrefs({ referencePlace: DUHOK });
      await renderRow();
      expect(screen.getByText(`Near ${isolated("Duhok")}`)).toBeTruthy();
      expect(screen.queryByText(/36\.|42\./)).toBeNull();
      expect(screen.getByText("My location")).toBeTruthy();
      expect(screen.getByTestId("account-location-row").props.accessibilityLabel).toBe(
        `My location, Near ${isolated("Duhok")}`,
      );
    });

    it("auto without permission: '{place} · Location off' (Hawler fallback)", async () => {
      mockGetPermission.mockResolvedValue({ status: "denied" });
      setPrefs({ referencePlace: null });
      await renderRow();
      expect(screen.getByText(`${isolated("Hawler")} · Location off`)).toBeTruthy();
    });

    it("manual: '{place} · Chosen by you'", async () => {
      setPrefs({ referencePlace: DUHOK, referenceSource: "manual" });
      await renderRow();
      expect(screen.getByText(`${isolated("Duhok")} · Chosen by you`)).toBeTruthy();
    });

    it("names the place in Sorani: auto with location", async () => {
      await i18n.changeLanguage("ckb");
      await renderRow();
      expect(screen.getByText("شوێنەکەم")).toBeTruthy();
      expect(screen.getByText(`نزیک ${isolated("هەولێر")}`)).toBeTruthy();
    });

    it("names the place in Sorani: auto without permission", async () => {
      await i18n.changeLanguage("ckb");
      mockGetPermission.mockResolvedValue({ status: "denied" });
      await renderRow();
      expect(screen.getByText(`${isolated("هەولێر")} · شوێن کوژاوەتەوە`)).toBeTruthy();
    });

    it("names the place in Sorani: manual", async () => {
      await i18n.changeLanguage("ckb");
      setPrefs({ referenceSource: "manual" });
      await renderRow();
      expect(screen.getByText(`${isolated("هەولێر")} · تۆ هەڵتبژاردووە`)).toBeTruthy();
    });
  });

  describe("expanded body", () => {
    it("hides 'Use my location' when already automatic with permission, but still offers the search", async () => {
      await renderRow();
      await openRow();
      expect(screen.queryByTestId("account-location-use")).toBeNull();
      expect(screen.getByTestId("account-location-search")).toBeTruthy();
    });

    it("offers 'Use my location' when the source is manual", async () => {
      setPrefs({ referencePlace: DUHOK, referenceSource: "manual" });
      await renderRow();
      await openRow();
      expect(screen.getByTestId("account-location-use")).toBeTruthy();
    });

    it("'Use my location' on a grant switches to automatic, checks now and collapses", async () => {
      mockGetPermission.mockResolvedValue({ status: "denied" });
      setPrefs({
        referencePlace: DUHOK,
        referenceSource: "manual",
        referenceCheckedAt: Date.now(),
      });
      await renderRow();
      await openRow();

      // The system now grants; the daily check then reads the fix.
      mockGetPermission.mockResolvedValue({ status: "granted" });
      await act(async () => {
        fireEvent.press(screen.getByTestId("account-location-use"));
      });
      await flush();

      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
      const state = usePrefsStore.getState();
      expect(state.referenceSource).toBe("auto");
      expect(state.referencePlace?.placeId).toBe("erbil");
      expect(screen.queryByTestId("account-location-search")).toBeNull();
      expect(screen.getByText(`Near ${isolated("Hawler")}`)).toBeTruthy();
    });

    it("a refusal keeps the current state and shows one short line", async () => {
      mockGetPermission.mockResolvedValue({ status: "denied" });
      mockRequestPermission.mockResolvedValue({ status: "denied", granted: false });
      setPrefs({ referencePlace: DUHOK, referenceSource: "manual" });
      await renderRow();
      await openRow();

      await act(async () => {
        fireEvent.press(screen.getByTestId("account-location-use"));
      });
      await flush();

      const state = usePrefsStore.getState();
      expect(state.referenceSource).toBe("manual");
      expect(state.referencePlace?.placeId).toBe("duhok");
      expect(screen.getByTestId("account-location-denied")).toBeTruthy();
      expect(screen.getByText("Location is off. Allow it in Settings.")).toBeTruthy();
      // Still expanded, and the value line is unchanged.
      expect(screen.getByTestId("account-location-search")).toBeTruthy();
      expect(screen.getByText(`${isolated("Duhok")} · Chosen by you`)).toBeTruthy();
    });

    it("choosing a place in the search makes it manual and collapses", async () => {
      // No fix: the search lists the main towns.
      mockGetPermission.mockResolvedValue({ status: "denied" });
      await renderRow();
      await openRow();

      await act(async () => {
        fireEvent.press(screen.getByTestId("account-location-search-result-duhok"));
      });
      await flush();

      const state = usePrefsStore.getState();
      expect(state.referenceSource).toBe("manual");
      expect(state.referencePlace?.placeId).toBe("duhok");
      expect(state.referencePlace?.lat).toBeCloseTo(36.87, 1);
      expect(screen.queryByTestId("account-location-search")).toBeNull();
      expect(screen.getByText(`${isolated("Duhok")} · Chosen by you`)).toBeTruthy();
    });
  });
});
