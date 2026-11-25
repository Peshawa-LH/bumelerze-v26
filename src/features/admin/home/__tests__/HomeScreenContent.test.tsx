import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { HomeScreenContent } from "../HomeScreenContent";
import {
  parseAdminHomeState,
  parseFoundEvents,
  type AdminHomeEvent,
  type AdminHomeState,
  type HomeAdminTransport,
} from "../transport";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "admin-1" }),
}));

const mockHub = makeTransport({ permissions: [] });
const FIRST_PAINT = { timeout: 5000 };
const T = Date.parse("2026-11-20T10:00:00Z");
const LATER = Date.now() + 2 * 86_400_000;

const ev = (id: string, onHomeUntil: number | null = null): AdminHomeEvent => ({
  eventId: `uuid-${id}`,
  bumelerzeId: id,
  place: "Near Halabja",
  magnitude: 4.6,
  originTime: T,
  onHomeUntil,
});

function transport(
  state: AdminHomeState = { notice: null, pins: [] },
  overrides: Partial<HomeAdminTransport> = {},
) {
  return {
    fetchState: jest.fn(async () => state),
    findEvents: jest.fn(async (_query: string) => [
      ev("bml2026x01"),
      ev("bml2026x02", LATER),
    ]),
    postNotice: jest.fn(async () => "n2"),
    removeNotice: jest.fn(async () => true),
    pin: jest.fn(async () => undefined),
    unpin: jest.fn(async () => true),
    ...overrides,
  } as jest.Mocked<HomeAdminTransport>;
}

async function render(permissions: Permission[], t = transport()) {
  mockHub.fetchMyPermissions.mockResolvedValue(permissions);
  await renderWithProviders(<HomeScreenContent transport={t} hubTransport={mockHub} />);
  return t;
}

describe("Admin > Home screen (B2.6 stage 1)", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("is for home.manage only (owner choice 1: admins)", async () => {
    await render(["hubs.open", "stats.read"]);
    expect(
      await screen.findByTestId("home-admin-no-access", {}, FIRST_PAINT),
    ).toBeTruthy();
    expect(screen.queryByTestId("home-admin-form")).toBeNull();
  });

  it("shows the approved wording and an empty Home", async () => {
    await render(["home.manage"]);
    expect(await screen.findByTestId("home-admin-form", {}, FIRST_PAINT)).toBeTruthy();
    expect(
      screen.getByText(
        "What you add here shows at the top of Home for everyone within about 2 minutes. It ends by itself at the time you choose.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Message on Home")).toBeTruthy();
    expect(screen.getByText("Earthquakes on Home")).toBeTruthy();
    expect(await screen.findByTestId("home-admin-pins-empty")).toHaveTextContent(
      "No earthquake is on Home by hand right now.",
    );
    expect(screen.queryByTestId("home-admin-replaces")).toBeNull();
    // Four text boxes, one per language, in the app's language order.
    for (const code of ["en", "ckb", "kmr", "ar"]) {
      expect(screen.getByTestId(`home-admin-text-${code}`)).toBeTruthy();
    }
  });

  it("refuses to post with no text, before asking the server", async () => {
    const t = await render(["home.manage"]);
    await act(async () => {
      fireEvent.press(await screen.findByTestId("home-admin-post", {}, FIRST_PAINT));
    });
    expect(screen.getByTestId("home-admin-notice-error")).toHaveTextContent(
      "Write the message in at least one language.",
    );
    expect(t.postNotice).not.toHaveBeenCalled();
  });

  it("posts the filled languages with the chosen kind and time", async () => {
    const t = await render(["home.manage"]);
    await screen.findByTestId("home-admin-form", {}, FIRST_PAINT);
    await act(async () => {
      fireEvent.changeText(
        screen.getByTestId("home-admin-text-en"),
        "  Stay away from damaged buildings. ",
      );
      fireEvent.changeText(
        screen.getByTestId("home-admin-text-ckb"),
        "لە بیناکان دوور بکەوە",
      );
      fireEvent.press(screen.getByTestId("home-admin-kind-important"));
      fireEvent.press(screen.getByTestId("home-admin-hours-6"));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("home-admin-post"));
    });
    expect(t.postNotice).toHaveBeenCalledWith({
      kind: "important",
      texts: { en: "Stay away from damaged buildings.", ckb: "لە بیناکان دوور بکەوە" },
      hours: 6,
    });
    expect(await screen.findByText("Message posted")).toBeTruthy();
    expect(screen.getByTestId("home-admin-text-en").props.value).toBe("");
  });

  it("shows the message on Home now, warns that a new one replaces it, and removes it", async () => {
    const t = await render(
      ["home.manage"],
      transport({
        notice: {
          id: "n1",
          kind: "important",
          texts: { en: "Aftershocks are likely.", ar: "يُتوقع حدوث هزات ارتدادية." },
          endsAt: LATER,
        },
        pins: [],
      }),
    );
    const card = await screen.findByTestId("home-admin-notice", {}, FIRST_PAINT);
    expect(card).toHaveTextContent(/Important/);
    expect(card).toHaveTextContent(/On Home until/);
    expect(screen.getByTestId("home-admin-notice-en")).toHaveTextContent(
      "Aftershocks are likely.",
    );
    expect(screen.getByTestId("home-admin-notice-ar")).toBeTruthy();
    expect(screen.getByTestId("home-admin-replaces")).toHaveTextContent(
      "This replaces the message on Home now.",
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("home-admin-notice-remove"));
    });
    expect(t.removeNotice).toHaveBeenCalled();
    expect(await screen.findByText("Message removed")).toBeTruthy();
  });

  it("names the server's errors in the approved words", async () => {
    const t = await render(
      ["home.manage"],
      transport(undefined, {
        postNotice: jest.fn(async () => {
          throw new Error("admin_post_home_notice: home_notice_too_long");
        }),
      }),
    );
    await screen.findByTestId("home-admin-form", {}, FIRST_PAINT);
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("home-admin-text-kmr"), "Silav");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("home-admin-post"));
    });
    expect(t.postNotice).toHaveBeenCalled();
    expect(screen.getByTestId("home-admin-notice-error")).toHaveTextContent(
      "A message can be up to 200 characters.",
    );
  });

  it("shows an earthquake on Home for the chosen days", async () => {
    const t = await render(["home.manage"]);
    await act(async () => {
      fireEvent.press(
        await screen.findByTestId("home-admin-pin-open-uuid-bml2026x01", {}, FIRST_PAINT),
      );
    });
    expect(screen.getByTestId("home-admin-pin-sheet-uuid-bml2026x01")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("home-admin-pin-days-30"));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("home-admin-pin-confirm"));
    });
    expect(t.pin).toHaveBeenCalledWith("uuid-bml2026x01", 30);
    expect(await screen.findByText("Shown on Home")).toBeTruthy();
    // One already on Home shows its end time instead of the button.
    expect(screen.queryByTestId("home-admin-pin-open-uuid-bml2026x02")).toBeNull();
    expect(screen.getByTestId("home-admin-found-uuid-bml2026x02")).toHaveTextContent(
      /On Home until/,
    );
  });

  it("with three on Home, says so and offers no fourth (owner choice 5)", async () => {
    const t = await render(
      ["home.manage"],
      transport({
        notice: null,
        pins: [ev("bml2026a", LATER), ev("bml2026b", LATER), ev("bml2026c", LATER)],
      }),
    );
    expect(
      await screen.findByTestId("home-admin-full", {}, FIRST_PAINT),
    ).toHaveTextContent("Three earthquakes are on Home already. Remove one first.");
    const button = await screen.findByTestId("home-admin-pin-open-uuid-bml2026x01");
    expect(button.props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(screen.getByTestId("home-admin-unpin-uuid-bml2026a"));
    });
    expect(t.unpin).toHaveBeenCalledWith("uuid-bml2026a");
    expect(await screen.findByText("Removed from Home")).toBeTruthy();
  });

  it("searches after a short pause", async () => {
    jest.useFakeTimers();
    try {
      const t = await render(["home.manage"]);
      await screen.findByTestId("home-admin-search", {}, FIRST_PAINT);
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("home-admin-search"), "turkey");
        jest.advanceTimersByTime(400);
      });
      await waitFor(() => expect(t.findEvents).toHaveBeenCalledWith("turkey"));
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("the server's answers", () => {
  it("reads admin_home_screen()", () => {
    const state = parseAdminHomeState({
      notice: {
        notice_id: "n1",
        kind: "important",
        texts: { en: "Hello", kmr: "Silav" },
        starts_at: "2026-11-25T10:00:00Z",
        ends_at: "2026-11-26T10:00:00Z",
      },
      pins: [
        {
          event_id: "u1",
          bumelerze_id: "bml2026x01",
          place: "Near Halabja",
          magnitude: 4.6,
          origin_time: "2026-11-24T10:00:00Z",
          pinned_at: "2026-11-25T10:00:00Z",
          ends_at: "2026-11-28T10:00:00Z",
        },
        { event_id: "bad" },
      ],
    });
    expect(state.notice).toEqual({
      id: "n1",
      kind: "important",
      texts: { en: "Hello", kmr: "Silav" },
      endsAt: Date.parse("2026-11-26T10:00:00Z"),
    });
    expect(state.pins).toHaveLength(1);
    expect(state.pins[0]?.onHomeUntil).toBe(Date.parse("2026-11-28T10:00:00Z"));
  });

  it("reads an empty or old answer as nothing", () => {
    expect(parseAdminHomeState(null)).toEqual({ notice: null, pins: [] });
    expect(parseAdminHomeState({ notice: null, pins: [] })).toEqual({
      notice: null,
      pins: [],
    });
  });

  it("reads admin_home_find_events()", () => {
    const found = parseFoundEvents([
      {
        event_id: "u1",
        bumelerze_id: "bml2026x01",
        place: null,
        magnitude: "3.1",
        origin_time: "2025-10-24T10:00:00Z",
        pinned_until: null,
      },
      {
        event_id: "u2",
        bumelerze_id: "bml2026x02",
        place: "Eastern Turkey",
        magnitude: 5,
        origin_time: "2026-11-15T10:00:00Z",
        pinned_until: "2026-11-26T10:00:00Z",
      },
    ]);
    expect(found.map((e) => [e.eventId, e.magnitude, e.onHomeUntil])).toEqual([
      ["u1", 3.1, null],
      ["u2", 5, Date.parse("2026-11-26T10:00:00Z")],
    ]);
  });
});
