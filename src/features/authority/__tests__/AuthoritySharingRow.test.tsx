import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";

import { AuthoritySharingRow } from "../components/AuthoritySharingRow";
import { parseSharing, type AuthorityTransport } from "../transport";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "u1" }),
}));

function transport(enabled = false) {
  return {
    fetchOverview: jest.fn(),
    fetchEventSafety: jest.fn(),
    fetchPeople: jest.fn(),
    fetchSharing: jest.fn(async () => ({ enabled, changedAt: null })),
    setSharing: jest.fn(async (on: boolean) => ({ enabled: on, changedAt: 1 })),
  } as jest.Mocked<AuthorityTransport>;
}

describe("Settings > Account: share with government officials", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("is off by default and says exactly what switching on shares", async () => {
    await renderWithProviders(<AuthoritySharingRow transport={transport()} />);
    expect(await screen.findByTestId("authority-sharing-row")).toHaveTextContent(
      /Let government officials see my building's safety estimate and my 'I'm safe' status/,
    );
    expect(screen.getByTestId("authority-sharing-row")).toHaveTextContent(
      /never the address/,
    );
    await waitFor(() =>
      expect(screen.getByTestId("authority-sharing-switch").props.value).toBe(false),
    );
  });

  it("switches on through the server and shows the new state", async () => {
    const t = transport();
    await renderWithProviders(<AuthoritySharingRow transport={t} />);
    await waitFor(() =>
      expect(screen.getByTestId("authority-sharing-switch").props.disabled).toBe(false),
    );
    await act(async () => {
      fireEvent(screen.getByTestId("authority-sharing-switch"), "valueChange", true);
    });
    expect(t.setSharing).toHaveBeenCalledWith(true);
    await waitFor(() =>
      expect(screen.getByTestId("authority-sharing-switch").props.value).toBe(true),
    );
  });

  it("is hidden when the server cannot answer (before migration 0066)", async () => {
    const t = transport();
    t.fetchSharing.mockRejectedValue(new Error("missing"));
    await renderWithProviders(<AuthoritySharingRow transport={t} />);
    await waitFor(() => expect(t.fetchSharing).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("authority-sharing-row")).toBeNull());
  });

  it("parses the server's answer", () => {
    expect(parseSharing({ enabled: true, changed_at: "2026-10-14T10:00:00Z" })).toEqual({
      enabled: true,
      changedAt: Date.parse("2026-10-14T10:00:00Z"),
    });
    expect(parseSharing(null)).toEqual({ enabled: false, changedAt: null });
  });
});
