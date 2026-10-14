import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { HubsContent } from "../HubsContent";
import { parseHubEvents, type HubAdminTransport, type HubEvent } from "../transport";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "admin-1" }),
}));

const mockHub = makeTransport({ permissions: [] });
const T = Date.parse("2026-10-01T10:00:00Z");

const ev = (id: string, open: boolean, note: HubEvent["note"] = null): HubEvent => ({
  eventId: `uuid-${id}`,
  bumelerzeId: id,
  place: "Near Ranya",
  magnitude: 5.1,
  originTime: T,
  open,
  note,
});

function transport(overrides: Partial<HubAdminTransport> = {}) {
  return {
    fetchEvents: jest.fn(async (_query: string) => ({
      open: [
        ev("bml20170001", true, { commentId: "c1", body: "Share your memories here." }),
      ],
      events: [ev("bml2026x01", false)],
    })),
    setOpen: jest.fn(async () => undefined),
    postNote: jest.fn(async () => "c2"),
    ...overrides,
  } as jest.Mocked<HubAdminTransport>;
}

async function render(permissions: Permission[], t = transport()) {
  mockHub.fetchMyPermissions.mockResolvedValue(permissions);
  await renderWithProviders(<HubsContent transport={t} hubTransport={mockHub} />);
  return t;
}

describe("Admin > Open a hub for an earthquake (owner answer 7)", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    if (i18n.language !== "en") await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("lists the open hubs first, with their pinned note, then the latest earthquakes", async () => {
    await render(["hubs.open"]);
    expect(await screen.findByTestId("hub-event-bml20170001")).toHaveTextContent(
      /5\.1.* · Near Ranya/,
    );
    expect(screen.getByTestId("hub-note-bml20170001")).toHaveTextContent(
      "Pinned: Share your memories here.",
    );
    expect(screen.getByTestId("hub-close-bml20170001")).toBeTruthy();
    expect(screen.getByTestId("hub-open-bml2026x01")).toBeTruthy();
  });

  it("opens and closes a hub", async () => {
    const t = await render(["hubs.open"]);
    await act(async () => {
      fireEvent.press(await screen.findByTestId("hub-open-bml2026x01"));
    });
    expect(t.setOpen).toHaveBeenCalledWith("uuid-bml2026x01", true);
    await act(async () => {
      fireEvent.press(screen.getByTestId("hub-close-bml20170001"));
    });
    expect(t.setOpen).toHaveBeenCalledWith("uuid-bml20170001", false);
  });

  it("searches by Bumelerze id after a short pause", async () => {
    jest.useFakeTimers();
    try {
      const t = await render(["hubs.open"]);
      await screen.findByTestId("hubs-search");
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("hubs-search"), "bml2026");
        jest.advanceTimersByTime(400);
      });
      await waitFor(() => expect(t.fetchEvents).toHaveBeenCalledWith("bml2026"));
    } finally {
      jest.useRealTimers();
    }
  });

  it("posts the pinned note as the official account and closes the sheet", async () => {
    const t = await render(["hubs.open"]);
    await fireEvent.press(await screen.findByTestId("hub-write-note-bml20170001"));
    expect(await screen.findByTestId("hub-note-sheet")).toBeTruthy();
    expect(screen.getByText(/Posted as the official Bumelerze account/)).toBeTruthy();
    expect(screen.getByTestId("hub-note-post").props.accessibilityState.disabled).toBe(
      true,
    );
    await act(async () => {
      fireEvent.changeText(
        screen.getByTestId("hub-note-input"),
        "  Aftershocks are expected.  ",
      );
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("hub-note-post"));
    });
    expect(t.postNote).toHaveBeenCalledWith(
      "uuid-bml20170001",
      "Aftershocks are expected.",
    );
    await waitFor(() => expect(screen.queryByTestId("hub-note-sheet")).toBeNull());
  });

  it("explains when the official account is not ready", async () => {
    const t = transport({
      postNote: jest.fn(async () => {
        throw new Error("admin_post_hub_note: official_account_not_ready");
      }),
    });
    await render(["hubs.open"], t);
    await fireEvent.press(await screen.findByTestId("hub-write-note-bml20170001"));
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("hub-note-input"), "Hello");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("hub-note-post"));
    });
    expect(await screen.findByTestId("hub-note-error")).toHaveTextContent(
      /has not accepted the community guidelines yet/,
    );
  });

  it("opens the hub itself", async () => {
    await render(["hubs.open"]);
    await fireEvent.press(await screen.findByTestId("hub-view-bml20170001"));
    expect(mockPush).toHaveBeenCalledWith("/event-hub/bml20170001");
  });

  it("shows nothing without hubs.open, and never asks the server", async () => {
    const t = await render(["comments.moderate", "hubs.feature"]);
    expect(await screen.findByTestId("hubs-no-access")).toBeTruthy();
    expect(t.fetchEvents).not.toHaveBeenCalled();
  });
});

describe("parseHubEvents", () => {
  it("reads both lists and skips broken rows", () => {
    const parsed = parseHubEvents({
      open: [
        {
          event_id: "e1",
          bumelerze_id: "bml1",
          place: "Halabja",
          magnitude: "7.3",
          origin_time: "2017-11-12T18:18:17Z",
          hub_featured: true,
          note: { comment_id: "c1", body: "Remember" },
        },
        { event_id: "bad" },
      ],
      events: "nope",
    });
    expect(parsed.open).toHaveLength(1);
    expect(parsed.open[0]?.magnitude).toBe(7.3);
    expect(parsed.open[0]?.note?.body).toBe("Remember");
    expect(parsed.events).toEqual([]);
  });
});
