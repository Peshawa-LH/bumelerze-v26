import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { OfficialsContent } from "../components/OfficialsContent";
import { CommunityError } from "@/features/community/types";
import {
  parseEventSafety,
  parseOverview,
  parsePeople,
  parsePeoplePage,
  type AuthorityTransport,
} from "../transport";
import { PEOPLE_LIMIT } from "../types";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "gov-1" }),
}));

const mockHub = makeTransport({ permissions: [] });
const EVENT = {
  event_id: "e1",
  bumelerze_id: "bml2026x01",
  magnitude: 5.1,
  place: "Near Ranya",
  origin_time: "2026-10-01T10:00:00Z",
};

const OVERVIEW = parseOverview({
  areas: [
    { area: "halabja", classes: { A: null, B: null, C: 5, D: null, E: null, F: null } },
    { area: "other", classes: { A: 7, B: null, C: null, D: null, E: null, F: null } },
  ],
  classes: { A: 7, B: 0, C: 5, D: 0, E: 0, F: 0 },
  events: [{ ...EVENT, checkins: 12 }],
});

function transport(overrides: Partial<AuthorityTransport> = {}) {
  return {
    fetchOverview: jest.fn(async () => OVERVIEW),
    fetchEventSafety: jest.fn(async () =>
      parseEventSafety({
        event: EVENT,
        checkins: 12,
        areas: [
          { area: "halabja", people: 7, safe: 5 },
          { area: "other", people: 9, safe: null },
        ],
      }),
    ),
    fetchPeople: jest.fn(async (offset: number) =>
      parsePeoplePage(
        {
          people: [
            {
              user_id: "u1",
              username: "shilan",
              display_name: "Shilan",
              homes: [{ area: "halabja", kind: "house", vc: "B", vc_range: "A-C" }],
              safe: { checked_in_at: "2026-10-01T10:20:00Z", ...EVENT },
            },
          ],
          more: false,
          offset,
          views_left: 19,
        },
        offset,
      ),
    ),
    ...overrides,
  } as jest.Mocked<AuthorityTransport>;
}

async function render(permissions: Permission[], t = transport()) {
  mockHub.fetchMyPermissions.mockResolvedValue(permissions);
  await renderWithProviders(<OfficialsContent transport={t} hubTransport={mockHub} />);
  return t;
}

describe("Officials page (owner decision 2026-10-13)", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    if (i18n.language !== "en") await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("opens with aggregates: classes with letter and name, and areas with hidden cells as <5", async () => {
    const t = await render(["authority.view"]);
    expect(await screen.findByTestId("officials-buildings")).toBeTruthy();
    expect(screen.getByTestId("officials-vc-A")).toHaveTextContent(
      /A.*Most vulnerable.*7/,
    );
    expect(screen.getByTestId("officials-area-halabja-C")).toHaveTextContent(/C.*5/);
    expect(screen.getByTestId("officials-area-halabja-A")).toHaveTextContent(
      /A\u2066<5\u2069/,
    );
    expect(screen.getByTestId("officials-area-halabja-A").props.accessibilityLabel).toBe(
      "Class A, Most vulnerable: fewer than 5",
    );
    expect(screen.getByTestId("officials-area-other")).toHaveTextContent(/Other areas/);
    // the list of people is NOT loaded until asked for
    expect(t.fetchPeople).not.toHaveBeenCalled();
  });

  it("shows I'm safe by area for the latest earthquake, fewer than 5 in words", async () => {
    const t = await render(["authority.view"]);
    await waitFor(() => expect(t.fetchEventSafety).toHaveBeenCalledWith("e1"));
    expect(await screen.findByTestId("officials-safety-halabja")).toHaveTextContent(
      /5.* of .*7.* safe \(.*71.*%\)/,
    );
    expect(screen.getByTestId("officials-safety-other")).toHaveTextContent(
      /fewer than 5 of .*9.* safe/,
    );
    await fireEvent.press(screen.getByTestId("officials-felt-map"));
    expect(mockPush).toHaveBeenCalledWith("/event/bml2026x01");
  });

  it("lists account holders with a public profile only after a tap: area and class, never an address (D98, 0082)", async () => {
    const t = await render(["authority.view"]);
    const section = await screen.findByTestId("officials-people");
    expect(section).toHaveTextContent(/People with an account/);
    expect(section).toHaveTextContent(
      /Account holders with a public profile, sorted by name, .*100.* at a time\. Private accounts are not shown\..*up to .*20.* pages in 24 hours\./,
    );
    expect(section).not.toHaveTextContent(
      /chose to share|switched this on|switch it off/,
    );
    await act(async () => {
      fireEvent.press(await screen.findByTestId("officials-people-show"));
    });
    await waitFor(() => expect(t.fetchPeople).toHaveBeenCalledTimes(1));
    expect(t.fetchPeople).toHaveBeenCalledWith(0);
    expect(await screen.findByTestId("officials-person-u1")).toHaveTextContent(/Shilan/);
    expect(screen.getByTestId("officials-people-left")).toHaveTextContent(
      /Pages left in the next 24 hours: .*19/,
    );
    expect(screen.queryByTestId("officials-people-next")).toBeNull();
    expect(screen.getByTestId("officials-person-home-u1-0")).toHaveTextContent(
      /Class B, Very vulnerable \(range .*A-C.*\) · .* area · House/,
    );
    expect(screen.getByTestId("officials-person-safe-u1")).toHaveTextContent(
      /I'm safe: .*Near Ranya/,
    );
  });

  it("says when there is nobody to list", async () => {
    await render(
      ["authority.view"],
      transport({
        fetchPeople: jest.fn(async () =>
          parsePeoplePage({ people: [], more: false, offset: 0, views_left: 19 }, 0),
        ),
      }),
    );
    await act(async () => {
      fireEvent.press(await screen.findByTestId("officials-people-show"));
    });
    expect(await screen.findByTestId("officials-people-empty")).toHaveTextContent(
      "No accounts yet.",
    );
    expect(screen.queryByTestId("officials-people-next")).toBeNull();
  });

  it("shows 100 at a time and asks for the next page only on a tap", async () => {
    const row = (i: number) => ({
      user_id: `u${i}`,
      username: `p${i}`,
      display_name: null,
      homes: [],
      safe: null,
    });
    const fetchPeople = jest.fn(async (offset: number) =>
      offset === 0
        ? parsePeoplePage(
            {
              people: Array.from({ length: PEOPLE_LIMIT }, (_, i) => row(i)),
              more: true,
              offset: 0,
              views_left: 19,
            },
            0,
          )
        : parsePeoplePage(
            { people: [row(100), row(101)], more: false, offset: 100, views_left: 18 },
            offset,
          ),
    );
    await render(["authority.view"], transport({ fetchPeople }));
    await act(async () => {
      fireEvent.press(await screen.findByTestId("officials-people-show"));
    });
    expect(await screen.findByTestId("officials-person-u99")).toBeTruthy();
    expect(screen.queryByTestId("officials-person-u100")).toBeNull();
    expect(fetchPeople).toHaveBeenCalledTimes(1);
    const next = screen.getByTestId("officials-people-next");
    expect(next).toHaveTextContent(/Show the next .*100/);
    await act(async () => {
      fireEvent.press(next);
    });
    expect(await screen.findByTestId("officials-person-u101")).toBeTruthy();
    expect(fetchPeople).toHaveBeenLastCalledWith(100);
    expect(screen.getByTestId("officials-person-u0")).toBeTruthy();
    expect(screen.queryByTestId("officials-people-next")).toBeNull();
    expect(screen.getByTestId("officials-people-left")).toHaveTextContent(/18/);
  });

  it("says plainly when the 20 pages of the day are used up", async () => {
    await render(
      ["authority.view"],
      transport({
        fetchPeople: jest.fn(async () => {
          throw new CommunityError("rate_limited", "authority_people: rate_limited");
        }),
      }),
    );
    await act(async () => {
      fireEvent.press(await screen.findByTestId("officials-people-show"));
    });
    expect(await screen.findByTestId("officials-people-error")).toHaveTextContent(
      /You have opened .*20.* pages of this list in the last 24 hours\. Try again later\./,
    );
  });

  it("is closed to admins and everyone else, and never asks the server", async () => {
    const t = await render([
      "comments.moderate",
      "people.view",
      "stats.read",
      "audit.read_all",
    ]);
    expect(await screen.findByTestId("officials-no-access")).toBeTruthy();
    expect(t.fetchOverview).not.toHaveBeenCalled();
  });

  it("works in Sorani with Eastern Arabic-Indic digits", async () => {
    await i18n.changeLanguage("ckb");
    await render(["authority.view"]);
    expect(await screen.findByTestId("officials-area-halabja-A")).toHaveTextContent(/<٥/);
    expect(screen.getByTestId("officials-vc-A")).toHaveTextContent(/٧/);
  });
});

describe("authority parsers", () => {
  it("keep null (fewer than 5) apart from 0", () => {
    expect(OVERVIEW.areas[0]?.classes.A).toBeNull();
    expect(OVERVIEW.classes.B).toBe(0);
  });

  it("read a page: more, where it starts and the pages left", () => {
    expect(parsePeoplePage({ people: [], more: true, offset: 100, views_left: 3 }, 100)).toEqual({
      people: [],
      more: true,
      offset: 100,
      viewsLeft: 3,
    });
    // an older server (0069) sends only the people
    expect(parsePeoplePage({ people: [] }, 0)).toEqual({
      people: [],
      more: false,
      offset: 0,
      viewsLeft: null,
    });
  });

  it("skip broken people and never invent a safe time", () => {
    const people = parsePeople({
      people: [
        { user_id: "u1", homes: [], safe: { checked_in_at: "nope" } },
        { nope: 1 },
      ],
    });
    expect(people).toHaveLength(1);
    expect(people[0]?.safe).toBeNull();
  });
});
