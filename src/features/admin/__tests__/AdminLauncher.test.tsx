import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { AdminContent } from "../components/AdminContent";
import { EMPTY_TOOL_COUNTS, parseToolCounts, type ToolCounts } from "../tools/transport";

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

/** The private admin rank: every tool but the public hubs.feature. */
const ADMIN: Permission[] = [
  "comments.moderate",
  "comments.delete",
  "badges.grant",
  "accounts.restrict",
  "accounts.suspend",
  "people.view",
  "audit.read",
  "audit.read_all",
  "feedback.manage",
  "photos.moderate",
  "filter.manage",
  "alerts.test",
  "stats.read",
  "hubs.open",
];

function counts(partial: Partial<ToolCounts> = {}) {
  return { fetchToolCounts: jest.fn(async () => ({ ...EMPTY_TOOL_COUNTS, ...partial })) };
}

async function render(permissions: Permission[], c = counts()) {
  mockHub.fetchMyPermissions.mockResolvedValue(permissions);
  await renderWithProviders(<AdminContent hubTransport={mockHub} countsTransport={c} />);
  return c;
}

describe("Admin launcher (review 15.1, mockup 5a)", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows the nine tools as tiles, in the mockup's order, with their status lines", async () => {
    await render(
      ADMIN,
      counts({
        accounts: 1284,
        waiting: 7,
        busy: false,
        alertsMode: "testers",
        alertDevices: 14,
        hubsOpen: 2,
        feedbackNew: 3,
      }),
    );
    const grid = await screen.findByTestId("admin-tiles");
    const ids = (grid.props.children as { props: { testID: string } }[]).map(
      (c) => c.props.testID,
    );
    expect(ids).toEqual([
      "admin-tile-people",
      "admin-tile-moderation",
      "admin-tile-hidden",
      "admin-tile-filter",
      "admin-tile-alerts",
      "admin-tile-stats",
      "admin-tile-hubs",
      "admin-tile-feedback",
      "admin-tile-activity",
    ]);
    await waitFor(() => expect(screen.getByText("1,284 accounts")).toBeTruthy());
    expect(screen.getByText("7 waiting")).toBeTruthy();
    expect(screen.getByText("Last 30 days")).toBeTruthy();
    expect(screen.getByText("Busy time: off")).toBeTruthy();
    expect(screen.getByText("Testers only · 14 devices")).toBeTruthy();
    expect(screen.getByText("Charts, 7 to 90 days")).toBeTruthy();
    expect(screen.getByText("2 hubs open")).toBeTruthy();
    expect(screen.getByText("3 new")).toBeTruthy();
    expect(screen.getByText("Who did what")).toBeTruthy();
    // the spoken label carries the status too
    expect(screen.getByTestId("admin-tile-moderation").props.accessibilityLabel).toBe(
      "Moderation queue, 7 waiting",
    );
  });

  it("has nothing usable inline: no queue, no badge form, no rows", async () => {
    await render(ADMIN);
    await screen.findByTestId("admin-tiles");
    for (const id of [
      "admin-queue",
      "admin-ranks",
      "admin-reports",
      "admin-people-row",
      "admin-feedback-row",
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it("opens each tool's own page", async () => {
    await render(ADMIN);
    const routes: Record<string, string> = {
      people: "/admin/people",
      moderation: "/admin/moderation",
      hidden: "/admin/hidden",
      filter: "/admin/filter",
      alerts: "/admin/alerts",
      stats: "/admin/stats",
      hubs: "/admin/hubs",
      feedback: "/admin/feedback",
      activity: "/admin/activity",
    };
    await screen.findByTestId("admin-tiles");
    for (const [key, route] of Object.entries(routes)) {
      await fireEvent.press(screen.getByTestId(`admin-tile-${key}`));
      expect(mockPush).toHaveBeenLastCalledWith(route);
    }
  });

  it("gives a moderator only their tools (no statistics, hubs, feedback, filter or alerts)", async () => {
    await render([
      "comments.moderate",
      "accounts.restrict",
      "people.view",
      "audit.read",
      "photos.moderate",
    ]);
    await screen.findByTestId("admin-tiles");
    expect(screen.getByTestId("admin-tile-moderation")).toBeTruthy();
    expect(screen.getByTestId("admin-tile-people")).toBeTruthy();
    for (const key of ["stats", "hubs", "feedback", "filter", "alerts"]) {
      expect(screen.queryByTestId(`admin-tile-${key}`)).toBeNull();
    }
  });

  it("says 'Nothing waiting' and drops the dot when the queue is empty", async () => {
    await render(ADMIN, counts({ waiting: 0, feedbackNew: 0 }));
    await waitFor(() => expect(screen.getByText("Nothing waiting")).toBeTruthy());
    expect(screen.getByText("Nothing new")).toBeTruthy();
  });

  it("still works when the server cannot count yet (before migration 0066)", async () => {
    const failing = {
      fetchToolCounts: jest.fn(async () => Promise.reject(new Error("missing"))),
    };
    await render(ADMIN, failing);
    expect(await screen.findByTestId("admin-tile-stats")).toBeTruthy();
    expect(screen.getByText("Comments, posts and felt photos")).toBeTruthy();
  });

  it("shows an ordinary account only a 'not allowed' line", async () => {
    const c = await render([]);
    expect(await screen.findByTestId("admin-no-access")).toBeTruthy();
    expect(screen.queryByTestId("admin-tiles")).toBeNull();
    expect(c.fetchToolCounts).not.toHaveBeenCalled();
  });

  it("is not for Government officials: their role opens no admin tool", async () => {
    await render(["authority.view"]);
    expect(await screen.findByTestId("admin-no-access")).toBeTruthy();
    expect(screen.queryByTestId("admin-tiles")).toBeNull();
  });

  it("reads numbers in Eastern Arabic-Indic digits in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    await render(ADMIN, counts({ waiting: 7, accounts: 12 }));
    await waitFor(() =>
      expect(screen.getByTestId("admin-tile-moderation")).toHaveTextContent(/٧ چاوەڕوان/),
    );
    expect(screen.getByText("دوایین ٣٠ ڕۆژ")).toBeTruthy();
  });
});

describe("parseToolCounts", () => {
  it("keeps only the keys the caller may see and ignores junk", () => {
    expect(
      parseToolCounts({ waiting: 3, hubs_open: "2", busy: true, alerts_mode: "public" }),
    ).toEqual({
      ...EMPTY_TOOL_COUNTS,
      waiting: 3,
      hubsOpen: 2,
      busy: true,
      alertsMode: "public",
    });
    expect(parseToolCounts(null)).toEqual(EMPTY_TOOL_COUNTS);
    expect(parseToolCounts({ waiting: "lots" }).waiting).toBeNull();
  });
});
