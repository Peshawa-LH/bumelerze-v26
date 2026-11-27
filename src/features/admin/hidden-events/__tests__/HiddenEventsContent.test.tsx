import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { CommunityError } from "@/features/community/types";
import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { HiddenEventsContent } from "../HiddenEventsContent";
import type {
  AdminHiddenEvent,
  HiddenEventsAdminTransport,
  HideCandidate,
  HideFoundEvent,
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
const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
}));

const mockHub = makeTransport({ permissions: [] });
const FIRST_PAINT = { timeout: 5000 };
const T = Date.parse("2026-11-26T08:15:00Z");
const HIDDEN_AT = Date.parse("2026-11-27T09:00:00Z");

const card = (id: string, overrides: Partial<HideFoundEvent> = {}): HideFoundEvent => ({
  eventId: `uuid-${id}`,
  bumelerzeId: id,
  place: "Near Halabja",
  magnitude: 4.6,
  originTime: T,
  status: "published",
  hidden: false,
  ...overrides,
});

const hiddenRow = (
  id: string,
  overrides: Partial<AdminHiddenEvent> = {},
): AdminHiddenEvent => ({
  eventId: `uuid-${id}`,
  bumelerzeId: id,
  place: "Near Ranya",
  magnitude: 4.1,
  originTime: T,
  status: "published",
  reason: "duplicate",
  note: null,
  hiddenAt: HIDDEN_AT,
  hiddenByName: "Peshawa",
  kept: null,
  ...overrides,
});

const candidate = (id: string): HideCandidate => ({
  eventId: `uuid-${id}`,
  bumelerzeId: id,
  place: "Near Halabja",
  magnitude: 4.8,
  originTime: T - 20_000,
  status: null,
  distanceKm: 12.4,
  minutesApart: 0.3,
});

function transport(
  hidden: AdminHiddenEvent[] = [],
  overrides: Partial<HiddenEventsAdminTransport> = {},
) {
  return {
    fetchHidden: jest.fn(async () => hidden),
    findEvents: jest.fn(async (_query: string) => [
      card("bml2026x02"),
      card("bml2026x03", { hidden: true }),
    ]),
    fetchCandidates: jest.fn(async (_id: string) => [candidate("bml2026x01")]),
    fetchImpact: jest.fn(async (_id: string) => ({
      feltReports: 12,
      safetyCheckins: 1,
      onHome: true,
    })),
    hide: jest.fn(async () => ({
      movedFeltReports: 12,
      movedCheckins: 1,
      unpinned: true,
    })),
    showAgain: jest.fn(async () => ({ movedBackFeltReports: 12, movedBackCheckins: 1 })),
    ...overrides,
  } as jest.Mocked<HiddenEventsAdminTransport>;
}

async function render(permissions: Permission[], t = transport()) {
  mockHub.fetchMyPermissions.mockResolvedValue(permissions);
  await renderWithProviders(<HiddenEventsContent transport={t} hubTransport={mockHub} />);
  return t;
}

async function openSheet() {
  await act(async () => {
    fireEvent.press(
      await screen.findByTestId("hidden-events-hide-uuid-bml2026x02", {}, FIRST_PAINT),
    );
  });
  // Let the sheet's two reads (candidates, impact) answer inside act.
  await screen.findByTestId("hide-impact");
  await waitFor(() => expect(screen.queryByText("Loading event…")).toBeNull());
  return screen.getByTestId("hide-sheet-uuid-bml2026x02");
}

describe("Admin > Hidden earthquakes (B2.6 stage 2)", () => {
  beforeEach(async () => {
    mockConfirm.mockReset();
    if (i18n.language !== "en") await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("is for events.hide only (owner choice 1: admins)", async () => {
    const t = await render(["home.manage", "hubs.open"]);
    expect(
      await screen.findByTestId("hidden-events-no-access", {}, FIRST_PAINT),
    ).toBeTruthy();
    expect(t.fetchHidden).not.toHaveBeenCalled();
    expect(screen.queryByTestId("hidden-events-search")).toBeNull();
  });

  it("shows the approved wording and an empty list (2.3-2.5)", async () => {
    await render(["events.hide"]);
    expect(
      await screen.findByText(
        "A hidden earthquake disappears from Home, Map and Significant for everyone within about 2 minutes. Its magnitude and location are never changed.",
        {},
        FIRST_PAINT,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Hidden now")).toBeTruthy();
    expect(await screen.findByTestId("hidden-events-empty")).toHaveTextContent(
      "Nothing is hidden.",
    );
    // The search reuses the hub tool's words.
    expect(screen.getByText("Find an earthquake")).toBeTruthy();
    expect(screen.getByPlaceholderText("Bumelerze ID (bml...) or place")).toBeTruthy();
  });

  it("lists what is hidden with the date and the reason; Other shows the note (2.6)", async () => {
    await render(
      ["events.hide"],
      transport([
        hiddenRow("bml2026x05"),
        hiddenRow("bml2026x06", { reason: "not_real" }),
        hiddenRow("bml2026x07", { reason: "other", note: "Test by the station team" }),
        hiddenRow("bml2026x08", { reason: "other", note: null }),
      ]),
    );
    expect(
      await screen.findByTestId("hidden-events-why-uuid-bml2026x05", {}, FIRST_PAINT),
    ).toHaveTextContent(/^Hidden .*27.*2026.* · Two cards for one earthquake$/);
    expect(screen.getByTestId("hidden-events-why-uuid-bml2026x06")).toHaveTextContent(
      /· Not a real earthquake$/,
    );
    expect(screen.getByTestId("hidden-events-why-uuid-bml2026x07")).toHaveTextContent(
      /· ⁨Test by the station team⁩$/,
    );
    expect(screen.getByTestId("hidden-events-why-uuid-bml2026x08")).toHaveTextContent(
      /· Other$/,
    );
    expect(screen.getByTestId("hidden-events-row-uuid-bml2026x05")).toHaveTextContent(
      /M .*4\.1.* · Near Ranya · .*bml2026x05/,
    );
  });

  it("asks before showing one again, then says so (2.7)", async () => {
    const t = await render(["events.hide"], transport([hiddenRow("bml2026x05")]));
    await act(async () => {
      fireEvent.press(
        await screen.findByTestId("hidden-events-show-uuid-bml2026x05", {}, FIRST_PAINT),
      );
    });
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Show this earthquake to everyone again?",
        message: "Felt reports that moved go back to it.",
        confirmLabel: "Show again",
        cancelLabel: "Cancel",
      }),
    );
    expect(t.showAgain).not.toHaveBeenCalled();
    await act(async () => {
      (mockConfirm.mock.calls[0]![0] as { onConfirm: () => void }).onConfirm();
    });
    expect(t.showAgain).toHaveBeenCalledWith("uuid-bml2026x05");
    expect(await screen.findByText("Shown again")).toBeTruthy();
  });

  it("offers Hide on a found earthquake and marks one already hidden (2.8, 2.9)", async () => {
    await render(["events.hide"]);
    expect(
      await screen.findByTestId("hidden-events-hide-uuid-bml2026x02", {}, FIRST_PAINT),
    ).toHaveTextContent("Hide");
    expect(screen.queryByTestId("hidden-events-hide-uuid-bml2026x03")).toBeNull();
    expect(screen.getByTestId("hidden-events-mark-uuid-bml2026x03")).toHaveTextContent(
      "Hidden",
    );
  });

  it("opens the sheet with the approved words, the candidates and what will change (2.10-2.17)", async () => {
    const t = await render(["events.hide"]);
    const sheet = await openSheet();
    expect(sheet).toHaveTextContent(/Hide this earthquake for everyone\?/);
    expect(screen.getByText("Why")).toBeTruthy();
    expect(screen.getByText("Two cards for one earthquake")).toBeTruthy();
    expect(screen.getByText("Not a real earthquake")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
    expect(
      screen.getByText(
        'Pick the card that stays. Links, felt reports and "I\'m safe" check-ins move to it.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("For example a quarry blast, a test, or an agency's mistake."),
    ).toBeTruthy();
    // A second card is the first choice, so its picker shows at once.
    expect(
      screen.getByTestId("hide-reason-duplicate").props.accessibilityState,
    ).toMatchObject({ checked: true });
    expect(screen.getByText("Card that stays")).toBeTruthy();
    expect(
      screen.getByText("Earthquakes within 10 minutes and 300 km of this one"),
    ).toBeTruthy();
    expect(await screen.findByTestId("hide-kept-uuid-bml2026x01")).toHaveTextContent(
      /M .*4\.8.* · Near Halabja · .* · .*12.* km.* · .*bml2026x01/,
    );
    expect(t.fetchCandidates).toHaveBeenCalledWith("uuid-bml2026x02");
    expect(screen.getByText('Short note (needed for "Other")')).toBeTruthy();
    expect(await screen.findByTestId("hide-impact")).toHaveTextContent(
      '12 felt reports · 1 "I\'m safe" check-in · On Home now: hiding takes it off Home',
    );
  });

  it("says when nothing is close enough to be the card that stays (2.15)", async () => {
    await render(
      ["events.hide"],
      transport([], { fetchCandidates: jest.fn(async () => []) }),
    );
    await openSheet();
    expect(await screen.findByTestId("hide-kept-none")).toHaveTextContent(
      "No other earthquake is close in time and place. Choose another reason.",
    );
  });

  it("leaves out the Home part of the impact line when it is not on Home", async () => {
    await render(
      ["events.hide"],
      transport([], {
        fetchImpact: jest.fn(async () => ({
          feltReports: 1,
          safetyCheckins: 0,
          onHome: false,
        })),
      }),
    );
    await openSheet();
    expect(await screen.findByTestId("hide-impact")).toHaveTextContent(
      '1 felt report · 0 "I\'m safe" check-ins',
    );
  });

  it("refuses a second card without the card that stays, before asking the server (2.19)", async () => {
    const t = await render(["events.hide"]);
    await openSheet();
    await act(async () => {
      fireEvent.press(screen.getByTestId("hide-confirm"));
    });
    expect(screen.getByTestId("hide-error")).toHaveTextContent(
      "Choose the card that stays.",
    );
    expect(t.hide).not.toHaveBeenCalled();
  });

  it("refuses Other without a note, before asking the server (2.20)", async () => {
    const t = await render(["events.hide"]);
    await openSheet();
    await act(async () => {
      fireEvent.press(screen.getByTestId("hide-reason-other"));
    });
    expect(screen.queryByTestId("hide-kept")).toBeNull();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("hide-note"), "   ");
      fireEvent.press(screen.getByTestId("hide-confirm"));
    });
    expect(screen.getByTestId("hide-error")).toHaveTextContent("Write a short note.");
    expect(t.hide).not.toHaveBeenCalled();
  });

  it("hides a second card in favour of the chosen card, then says when phones update (2.18)", async () => {
    const t = await render(["events.hide"]);
    await openSheet();
    await act(async () => {
      fireEvent.press(await screen.findByTestId("hide-kept-uuid-bml2026x01"));
    });
    expect(
      screen.getByTestId("hide-kept-uuid-bml2026x01").props.accessibilityState,
    ).toMatchObject({ checked: true });
    expect(screen.getByTestId("hide-confirm")).toHaveTextContent("Hide for everyone");
    await act(async () => {
      fireEvent.press(screen.getByTestId("hide-confirm"));
    });
    expect(t.hide).toHaveBeenCalledWith({
      eventId: "uuid-bml2026x02",
      reason: "duplicate",
      keptEventId: "uuid-bml2026x01",
      note: null,
    });
    expect(
      await screen.findByText("Hidden. Phones update within about 2 minutes."),
    ).toBeTruthy();
    expect(screen.queryByTestId("hide-sheet-uuid-bml2026x02")).toBeNull();
  });

  it("hides one that is not real with its note, never sending a card that stays", async () => {
    const t = await render(["events.hide"]);
    await openSheet();
    await act(async () => {
      fireEvent.press(await screen.findByTestId("hide-kept-uuid-bml2026x01"));
      fireEvent.press(screen.getByTestId("hide-reason-not_real"));
      fireEvent.changeText(
        screen.getByTestId("hide-note"),
        " Quarry blast near Tasluja ",
      );
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("hide-confirm"));
    });
    expect(t.hide).toHaveBeenCalledWith({
      eventId: "uuid-bml2026x02",
      reason: "not_real",
      keptEventId: null,
      note: "Quarry blast near Tasluja",
    });
  });

  it("names the server's refusals in the approved words", async () => {
    const t = await render(
      ["events.hide"],
      transport([], {
        hide: jest.fn(async () => {
          throw new Error("admin_hide_event: note_required");
        }),
      }),
    );
    await openSheet();
    await act(async () => {
      fireEvent.press(screen.getByTestId("hide-reason-other"));
      fireEvent.changeText(screen.getByTestId("hide-note"), "x");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("hide-confirm"));
    });
    expect(t.hide).toHaveBeenCalled();
    expect(screen.getByTestId("hide-error")).toHaveTextContent("Write a short note.");
  });

  it("words every refusal from 0085 (kept_*, note_*, not_allowed)", async () => {
    const cases: [string, string][] = [
      ["admin_hide_event: kept_hidden", "Choose the card that stays."],
      ["admin_hide_event: kept_is_same", "Choose the card that stays."],
      ["admin_hide_event: note_too_long", "Write a short note."],
      [
        "admin_hide_event: is_kept_card",
        "Another hidden earthquake points to this card. Show that one again first.",
      ],
    ];
    for (const [message, words] of cases) {
      await render(
        ["events.hide"],
        transport([], {
          hide: jest.fn(async () => {
            throw new Error(message);
          }),
        }),
      );
      await openSheet();
      await act(async () => {
        fireEvent.press(screen.getByTestId("hide-kept-uuid-bml2026x01"));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("hide-confirm"));
      });
      expect(screen.getByTestId("hide-error")).toHaveTextContent(words);
      await cleanup();
    }
    await render(
      ["events.hide"],
      transport([], {
        hide: jest.fn(async () => {
          throw new CommunityError("forbidden", "admin_hide_event: not_allowed");
        }),
      }),
    );
    await openSheet();
    await act(async () => {
      fireEvent.press(screen.getByTestId("hide-kept-uuid-bml2026x01"));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("hide-confirm"));
    });
    expect(screen.getByTestId("hide-error")).toHaveTextContent("Not allowed.");
  });

  it("when another admin acted first, says so plainly and reads the lists again", async () => {
    const t = await render(
      ["events.hide"],
      transport([], {
        hide: jest.fn(async () => {
          throw new CommunityError("not_found", "admin_hide_event: already_hidden");
        }),
      }),
    );
    await openSheet();
    expect(t.fetchHidden).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.press(screen.getByTestId("hide-kept-uuid-bml2026x01"));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("hide-confirm"));
    });
    expect(screen.getByTestId("hide-error")).toHaveTextContent(
      "Couldn't do that. Try again.",
    );
    await waitFor(() => expect(t.fetchHidden).toHaveBeenCalledTimes(2));
    expect(t.findEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("refreshes the list when one was shown again by someone else meanwhile", async () => {
    const t = await render(
      ["events.hide"],
      transport([hiddenRow("bml2026x05")], {
        showAgain: jest.fn(async () => {
          throw new CommunityError("unknown", "admin_unhide_event: not_hidden");
        }),
      }),
    );
    await act(async () => {
      fireEvent.press(
        await screen.findByTestId("hidden-events-show-uuid-bml2026x05", {}, FIRST_PAINT),
      );
    });
    await act(async () => {
      (mockConfirm.mock.calls[0]![0] as { onConfirm: () => void }).onConfirm();
    });
    expect(await screen.findByTestId("hidden-events-show-error")).toHaveTextContent(
      "Couldn't do that. Try again.",
    );
    await waitFor(() => expect(t.fetchHidden).toHaveBeenCalledTimes(2));
  });

  it("draws a possible earthquake (no id, place or magnitude) as Home names one", async () => {
    await render(
      ["events.hide"],
      transport(
        [
          hiddenRow("x", {
            eventId: "uuid-possible-1",
            bumelerzeId: null,
            place: null,
            magnitude: null,
            status: "possible",
            reason: "not_real",
          }),
        ],
        {
          findEvents: jest.fn(async () => [
            card("x", {
              eventId: "uuid-possible-2",
              bumelerzeId: null,
              place: null,
              magnitude: null,
              status: "possible",
            }),
          ]),
        },
      ),
    );
    expect(
      await screen.findByTestId("hidden-events-row-uuid-possible-1", {}, FIRST_PAINT),
    ).toHaveTextContent(/^Unconfirmed shaking nearby · .*2026.*Show again$/);
    expect(
      await screen.findByTestId("hidden-events-found-uuid-possible-2"),
    ).toHaveTextContent(/^Unconfirmed shaking nearby · .*2026/);
  });

  it("gives every choice a touch target of at least 44 pt", async () => {
    await render(["events.hide"]);
    await openSheet();
    await screen.findByTestId("hide-kept-uuid-bml2026x01");
    for (const id of [
      "hide-reason-duplicate",
      "hide-reason-not_real",
      "hide-reason-other",
      "hide-kept-uuid-bml2026x01",
    ]) {
      const style = StyleSheet.flatten(screen.getByTestId(id).props.style) as {
        minHeight?: number;
      };
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it("searches after a short pause", async () => {
    jest.useFakeTimers();
    try {
      const t = await render(["events.hide"]);
      await screen.findByTestId("hidden-events-search", {}, FIRST_PAINT);
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("hidden-events-search"), "ranya");
        jest.advanceTimersByTime(400);
      });
      await waitFor(() => expect(t.findEvents).toHaveBeenCalledWith("ranya"));
    } finally {
      jest.useRealTimers();
    }
  });

  it("reads in Sorani with Eastern Arabic-Indic digits", async () => {
    await i18n.changeLanguage("ckb");
    await render(["events.hide"]);
    await openSheet();
    expect(await screen.findByTestId("hide-impact")).toHaveTextContent(/١٢/);
    expect(screen.getByText("دوو کارت بۆ یەک بوومەلەرزە")).toBeTruthy();
  });
});
