import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";

import { TrashedHomesSection } from "../components/TrashedHomesSection";
import { parseTrashedRows } from "../transport";
import { HomeError } from "../types";
import {
  clearQueryClients,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
} from "../__fixtures__/testing";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: jest.fn(),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "u-owner" }),
}));

const DAY = 86_400_000;
const HOME = {
  tagId: "tag-1",
  code: "BMH-ABCD23",
  kind: "house" as const,
  label: "Grandma's house",
  unitLabel: null,
  trashedAt: Date.now() - DAY,
  purgeAt: Date.now() + 13 * DAY,
};

describe("Deleted homes (the 14-day trash)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(async () => {
    cleanup();
    await clearQueryClients();
  });

  it("parses the server's rows (no coordinates exist in them)", () => {
    const rows = parseTrashedRows([
      {
        tag_id: "t",
        code: "BMH-X",
        kind: "house",
        label: null,
        unit_label: null,
        trashed_at: "2026-10-01T00:00:00Z",
        purge_at: "2026-10-15T00:00:00Z",
        lat: 36.1,
      },
      { tag_id: "bad" },
    ]);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/lat|36\.1/);
  });

  it("is hidden when the trash is empty", async () => {
    await renderWithProviders(<TrashedHomesSection transport={mockTransport} />);
    await waitFor(() => expect(mockTransport.fetchTrashedHomes).toHaveBeenCalled());
    expect(screen.queryByTestId("trashed-homes")).toBeNull();
  });

  it("lists a trashed home with its last day and restores it", async () => {
    mockTransport.fetchTrashedHomes.mockResolvedValue([HOME]);
    await renderWithProviders(<TrashedHomesSection transport={mockTransport} />);
    expect(await screen.findByText("Grandma's house")).toBeTruthy();
    expect(screen.getByText(/^Deleted for good on /)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("restore-home-tag-1"));
    });
    expect(mockTransport.restoreHome).toHaveBeenCalledWith("tag-1");
    await waitFor(() =>
      expect(mockTransport.fetchTrashedHomes.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("Delete now asks first, then deletes", async () => {
    mockTransport.fetchTrashedHomes.mockResolvedValue([HOME]);
    await renderWithProviders(<TrashedHomesSection transport={mockTransport} />);
    await screen.findByText("Grandma's house");
    await act(async () => {
      fireEvent.press(screen.getByTestId("delete-home-now-tag-1"));
    });
    const options = mockConfirm.mock.calls[0]?.[0] as {
      destructive: boolean;
      message: string;
      onConfirm: () => void;
    };
    expect(options.destructive).toBe(true);
    expect(options.message).toMatch(/can't be undone/);
    expect(mockTransport.deleteHomeNow).not.toHaveBeenCalled();
    await act(async () => {
      options.onConfirm();
    });
    expect(mockTransport.deleteHomeNow).toHaveBeenCalledWith("tag-1");
    // the trash list is read again after the delete
    await waitFor(() =>
      expect(mockTransport.fetchTrashedHomes.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("the 5-home limit gets its own words", async () => {
    mockTransport.fetchTrashedHomes.mockResolvedValue([HOME]);
    mockTransport.restoreHome.mockRejectedValue(new HomeError("restore_limit"));
    await renderWithProviders(<TrashedHomesSection transport={mockTransport} />);
    await screen.findByText("Grandma's house");
    await act(async () => {
      fireEvent.press(screen.getByTestId("restore-home-tag-1"));
    });
    expect(await screen.findByTestId("trashed-home-error-tag-1")).toHaveTextContent(
      "You already have 5 homes. Delete one before restoring this one.",
    );
  });
});
