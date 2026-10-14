import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { OfficialsContent } from "../components/OfficialsContent";
import {
  parseEventSafety,
  parseOverview,
  parsePeople,
  type AuthorityTransport,
} from "../transport";

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
    fetchPeople: jest.fn(async () =>
      parsePeople({
        people: [
          {
            user_id: "u1",
            username: "shilan",
            display_name: "Shilan",
            homes: [{ area: "halabja", kind: "house", vc: "B", vc_range: "A-C" }],
            safe: { checked_in_at: "2026-10-01T10:20:00Z", ...EVENT },
          },
        ],
      }),
    ),
    fetchSharing: jest.fn(),
    setSharing: jest.fn(),
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
    expect(screen.getByTestId("officials-area-halabja-A")).toHaveTextContent(/A\u2066<5\u2069/);
    expect(screen.getByTestId("officials-area-halabja-A").props.accessibilityLabel).toBe(
      "Class A, Most vulnerable: fewer than 5",
    );
    expect(screen.getByTestId("officials-area-other")).toHaveTextContent(/Other areas/);
    // the opted-in list is NOT loaded until asked for
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

  it("lists the people who chose to share only after a tap: area and class, never an address", async () => {
    const t = await render(["authority.view"]);
    await act(async () => {
      fireEvent.press(await screen.findByTestId("officials-people-show"));
    });
    await waitFor(() => expect(t.fetchPeople).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("officials-person-u1")).toHaveTextContent(/Shilan/);
    expect(screen.getByTestId("officials-person-home-u1-0")).toHaveTextContent(
      /Class B, Very vulnerable \(range .*A-C.*\) · .* area · House/,
    );
    expect(screen.getByTestId("officials-person-safe-u1")).toHaveTextContent(
      /I'm safe: .*Near Ranya/,
    );
  });

  it("says when nobody has chosen to share", async () => {
    await render(["authority.view"], transport({ fetchPeople: jest.fn(async () => []) }));
    await act(async () => {
      fireEvent.press(await screen.findByTestId("officials-people-show"));
    });
    expect(await screen.findByTestId("officials-people-empty")).toBeTruthy();
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
