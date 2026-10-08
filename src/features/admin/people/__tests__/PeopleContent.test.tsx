import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";
import i18n from "@/i18n";

import { PeopleContent } from "../components/PeopleContent";
import { formatCount } from "../format";
import { fakePeopleTransport, page, row, stats } from "../__fixtures__/testing";
import { NO_FILTERS } from "../types";

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

const hub = makeTransport({ permissions: [] });
const MODERATOR: Permission[] = ["comments.moderate", "accounts.restrict", "people.view"];
const OFFICIAL: Permission[] = [
  ...MODERATOR,
  "accounts.suspend",
  "accounts.reset_password",
  "people.view_email",
  "people.view_guests",
];

async function render(
  permissions: Permission[],
  transport: ReturnType<typeof fakePeopleTransport>,
) {
  hub.fetchMyPermissions.mockResolvedValue(permissions);
  await renderWithProviders(<PeopleContent transport={transport} hubTransport={hub} />);
}

const lastQuery = (t: ReturnType<typeof fakePeopleTransport>) =>
  t.search.mock.calls[t.search.mock.calls.length - 1] as Parameters<
    ReturnType<typeof fakePeopleTransport>["search"]
  >;

describe("Admin > People", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    hub.fetchMyPermissions.mockReset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("access", () => {
    it("shows nothing but a 'not allowed' line without people.view and asks the server for nothing", async () => {
      const transport = fakePeopleTransport();
      await render(["comments.moderate"], transport);
      expect(await screen.findByTestId("people-no-access")).toBeTruthy();
      expect(transport.search).not.toHaveBeenCalled();
      expect(transport.stats).not.toHaveBeenCalled();
    });

    it("gives a moderator the accounts list only: no Guests / All tabs", async () => {
      const transport = fakePeopleTransport({ stats: stats({ guestsTotal: null, activeGuests7d: null, activeGuests30d: null }) });
      await render(MODERATOR, transport);
      expect(await screen.findByTestId("person-row-c2c2c2c2-0000-4000-8000-000000000000")).toBeTruthy();
      expect(screen.queryByTestId("people-tab-guests")).toBeNull();
      expect(screen.queryByTestId("people-tab-all")).toBeNull();
      expect(screen.queryByTestId("people-tab-accounts")).toBeNull();
      expect(lastQuery(transport)[0].tab).toBe("accounts");
    });

    it("gives an official the Guests and All tabs", async () => {
      await render(OFFICIAL, fakePeopleTransport());
      expect(await screen.findByTestId("people-tab-accounts")).toBeTruthy();
      expect(screen.getByTestId("people-tab-guests")).toBeTruthy();
      expect(screen.getByTestId("people-tab-all")).toBeTruthy();
    });

    it("does not hint at email search for a moderator", async () => {
      await render(MODERATOR, fakePeopleTransport());
      const input = await screen.findByTestId("people-search-input");
      expect(input.props.placeholder).not.toMatch(/email/i);
    });

    it("hints at email search for people.view_email", async () => {
      await render(OFFICIAL, fakePeopleTransport());
      expect((await screen.findByTestId("people-search-input")).props.placeholder).toMatch(/email/i);
    });
  });

  describe("stats header", () => {
    it("shows the numbers and says when the active counts start", async () => {
      await render(OFFICIAL, fakePeopleTransport());
      expect(await screen.findByTestId("people-stat-value-accounts")).toHaveTextContent("1,234");
      expect(screen.getByTestId("people-stat-value-guests")).toHaveTextContent("56");
      expect(screen.getByTestId("people-stat-value-new7")).toHaveTextContent("12");
      expect(screen.getByTestId("people-stat-value-new30")).toHaveTextContent("80");
      expect(screen.getByTestId("people-stat-value-active7")).toHaveTextContent("40");
      expect(screen.getByTestId("people-stat-active7")).toHaveTextContent(/guests: 5/);
      expect(screen.getByTestId("people-stat-value-restricted")).toHaveTextContent("3");
      expect(screen.getByTestId("people-stat-value-suspended")).toHaveTextContent("1");
      expect(screen.getByTestId("people-stats-platforms")).toHaveTextContent(
        /iOS 10 · Android 25 · Web 2/,
      );
      expect(screen.getByTestId("people-stats-since")).toHaveTextContent(/Active counts start on/);
    });

    it("leaves out the guest numbers when the server sends none (moderator)", async () => {
      await render(
        MODERATOR,
        fakePeopleTransport({
          stats: stats({ guestsTotal: null, activeGuests7d: null, activeGuests30d: null }),
        }),
      );
      expect(await screen.findByTestId("people-stat-accounts")).toBeTruthy();
      expect(screen.queryByTestId("people-stat-guests")).toBeNull();
      expect(screen.getByTestId("people-stat-active7")).not.toHaveTextContent(/guests/);
    });

    it("says so before presence tracking has data", async () => {
      await render(OFFICIAL, fakePeopleTransport({ stats: stats({ presenceSince: null }) }));
      expect(await screen.findByTestId("people-stats-since")).toHaveTextContent(
        /Active counts have not started yet\./,
      );
    });

    it("renders Eastern Arabic-Indic digits in Sorani and Arabic, Latin in Kurmanji", async () => {
      expect(formatCount(1234, "ckb")).toBe("١,٢٣٤");
      expect(formatCount(1234, "ar")).toBe("١,٢٣٤");
      expect(formatCount(1234, "kmr")).toBe("1,234");
      await i18n.changeLanguage("ckb");
      await render(OFFICIAL, fakePeopleTransport());
      expect(await screen.findByTestId("people-stat-value-accounts")).toHaveTextContent("١,٢٣٤");
      expect(screen.getByTestId("people-stat-value-new7")).toHaveTextContent("١٢");
      expect(screen.getByTestId("people-stats-platforms").props.children).toMatch(/١٠/);
    });
  });

  describe("rows", () => {
    it("shows name, @username, status, counts and open reports, and opens the person page", async () => {
      const r = row({ status: "restricted", openReports: 2, ranks: ["seismologist"] });
      await render(OFFICIAL, fakePeopleTransport({ pages: [page([r])] }));
      expect(await screen.findByTestId(`person-row-name-${r.userId}`)).toHaveTextContent("Aso Kareem");
      expect(screen.getByTestId(`person-row-status-${r.userId}`)).toHaveTextContent("Restricted");
      expect(screen.getByTestId(`person-row-counts-${r.userId}`)).toHaveTextContent(
        "Reports 2 · Comments 5 · Posts 1 · Homes: 1 own, 0 joined · Feedback 1",
      );
      expect(screen.getByTestId(`person-row-reports-${r.userId}`)).toHaveTextContent("2 open reports");
      expect(screen.getByText("@aso")).toBeTruthy();
      await fireEvent.press(screen.getByTestId(`person-row-${r.userId}`));
      expect(mockPush).toHaveBeenCalledWith(`/admin/person/${r.userId}`);
    });

    it("names a guest 'Guest' + the first 8 characters of its id", async () => {
      const g = row({
        userId: "49494949-0000-4000-8000-000000000000",
        kind: "guest",
        username: null,
        displayName: null,
      });
      await render(OFFICIAL, fakePeopleTransport({ pages: [page([g])] }));
      expect(await screen.findByTestId(`person-row-name-${g.userId}`)).toHaveTextContent(
        "Guest 49494949",
      );
    });

    it("shows the masked email only when the row carries one", async () => {
      const withMail = row({ maskedEmail: "a***@x.org" });
      const without = row({ userId: "u2", username: "bana", displayName: "Bana", maskedEmail: null });
      await render(OFFICIAL, fakePeopleTransport({ pages: [page([withMail, without])] }));
      expect(await screen.findByTestId(`person-row-email-${withMail.userId}`)).toHaveTextContent("a***@x.org");
      expect(screen.queryByTestId("person-row-email-u2")).toBeNull();
    });

    it("says so when nobody matches", async () => {
      await render(OFFICIAL, fakePeopleTransport({ pages: [page([])] }));
      expect(await screen.findByTestId("people-empty")).toBeTruthy();
    });

    it("words a failed search in plain language and retries", async () => {
      const { CommunityError } = jest.requireActual("@/features/community/types");
      const transport = fakePeopleTransport();
      transport.search.mockRejectedValueOnce(new CommunityError("forbidden"));
      await render(OFFICIAL, transport);
      expect(await screen.findByTestId("people-error")).toHaveTextContent("Not allowed.");
      await act(async () => {
        fireEvent.press(screen.getByTestId("people-retry"));
      });
      expect(
        await screen.findByTestId("person-row-c2c2c2c2-0000-4000-8000-000000000000"),
      ).toBeTruthy();
    });
  });

  describe("search", () => {
    it("waits for the typing to pause, then searches", async () => {
      const transport = fakePeopleTransport();
      await render(OFFICIAL, transport);
      await screen.findByTestId("person-row-c2c2c2c2-0000-4000-8000-000000000000");
      transport.search.mockClear();
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("people-search-input"), "a");
        fireEvent.changeText(screen.getByTestId("people-search-input"), "as");
        fireEvent.changeText(screen.getByTestId("people-search-input"), "aso");
      });
      expect(transport.search).not.toHaveBeenCalled();
      await waitFor(() => expect(transport.search).toHaveBeenCalledTimes(1));
      expect(lastQuery(transport)[0]).toMatchObject({ query: "aso", tab: "accounts", sort: "last_seen" });
      expect(lastQuery(transport)[1]).toBeNull();
    });

    it("does not search for a single character and says why", async () => {
      const transport = fakePeopleTransport();
      await render(OFFICIAL, transport);
      await screen.findByTestId("person-row-c2c2c2c2-0000-4000-8000-000000000000");
      transport.search.mockClear();
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("people-search-input"), "a");
      });
      expect(await screen.findByTestId("people-too-short")).toBeTruthy();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 450));
      });
      expect(transport.search.mock.calls.every((c) => c[0].query !== "a")).toBe(true);
    });

    it("passes device codes, IDs and home codes through untouched", async () => {
      const transport = fakePeopleTransport();
      await render(OFFICIAL, transport);
      await screen.findByTestId("people-search-input");
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("people-search-input"), "BMH-ABC234");
      });
      await waitFor(() => expect(lastQuery(transport)[0].query).toBe("BMH-ABC234"));
    });
  });

  describe("tabs, sort and filters", () => {
    it("switches to Guests and shows the idle-installs line", async () => {
      const guest = row({ userId: "49494949-0000-4000-8000-000000000000", kind: "guest", username: null, displayName: null });
      const transport = fakePeopleTransport({
        pages: [page([row()]), page([guest], { idleGuests: 1240 })],
      });
      await render(OFFICIAL, transport);
      await act(async () => {
        fireEvent.press(await screen.findByTestId("people-tab-guests"));
      });
      await waitFor(() => expect(lastQuery(transport)[0].tab).toBe("guests"));
      expect(await screen.findByTestId("people-idle-guests")).toHaveTextContent(
        "1,240 app installs with no activity are not listed.",
      );
    });

    it("sorts", async () => {
      const transport = fakePeopleTransport();
      await render(OFFICIAL, transport);
      await act(async () => {
        fireEvent.press(await screen.findByTestId("people-sort-open_reports"));
      });
      await waitFor(() => expect(lastQuery(transport)[0].sort).toBe("open_reports"));
    });

    it("applies filters from the sheet, counts them on the button and clears them", async () => {
      const transport = fakePeopleTransport();
      await render(OFFICIAL, transport);
      await act(async () => {
        fireEvent.press(await screen.findByTestId("people-filters-button"));
      });
      await act(async () => {
        fireEvent.press(await screen.findByTestId("filter-status-restricted"));
        fireEvent.press(screen.getByTestId("filter-reported"));
        fireEvent.press(screen.getByTestId("filter-active-7"));
        fireEvent.press(screen.getByTestId("filter-platform-ios"));
        fireEvent.press(screen.getByTestId("filter-rank-moderator"));
        fireEvent.changeText(screen.getByTestId("filter-joined-from"), "2026-09-01");
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("filter-apply"));
      });
      await waitFor(() => expect(lastQuery(transport)[0].filters.status).toBe("restricted"));
      const f = lastQuery(transport)[0].filters;
      expect(f).toMatchObject({ reported: true, activeDays: 7, platform: "ios", rank: "moderator" });
      expect(f.joinedFrom).toMatch(/^2026-0(8|9)-/);
      expect(screen.getByTestId("people-filters-button")).toHaveTextContent("Filters (6)");
      expect(screen.queryByTestId("people-filter-sheet")).toBeNull();

      await act(async () => {
        fireEvent.press(screen.getByTestId("people-filters-button"));
      });
      await act(async () => {
        fireEvent.press(await screen.findByTestId("filter-clear"));
      });
      await waitFor(() => expect(lastQuery(transport)[0].filters).toEqual(NO_FILTERS));
      expect(screen.getByTestId("people-filters-button")).toHaveTextContent("Filters");
    });

    it("hides the password filter from moderators", async () => {
      await render(MODERATOR, fakePeopleTransport());
      await act(async () => {
        fireEvent.press(await screen.findByTestId("people-filters-button"));
      });
      expect(await screen.findByTestId("filter-status-active")).toBeTruthy();
      expect(screen.queryByTestId("filter-password-yes")).toBeNull();
    });

    it("offers the password filter to those who may reset passwords", async () => {
      await render(OFFICIAL, fakePeopleTransport());
      await act(async () => {
        fireEvent.press(await screen.findByTestId("people-filters-button"));
      });
      expect(await screen.findByTestId("filter-password-yes")).toBeTruthy();
    });

    it("refuses a bad or reversed date range", async () => {
      await render(OFFICIAL, fakePeopleTransport());
      await act(async () => {
        fireEvent.press(await screen.findByTestId("people-filters-button"));
      });
      await act(async () => {
        fireEvent.changeText(await screen.findByTestId("filter-joined-from"), "2026-13-45");
      });
      expect(screen.getByTestId("filter-date-error")).toBeTruthy();
      expect(screen.getByTestId("filter-apply").props.accessibilityState.disabled).toBe(true);
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("filter-joined-from"), "2026-09-30");
        fireEvent.changeText(screen.getByTestId("filter-joined-to"), "2026-09-01");
      });
      expect(screen.getByTestId("filter-date-error")).toBeTruthy();
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("filter-joined-to"), "2026-10-05");
      });
      expect(screen.queryByTestId("filter-date-error")).toBeNull();
    });

    it("reads dates typed with Eastern Arabic-Indic digits", async () => {
      const { parseDay } = jest.requireActual("../components/PeopleFilterSheet");
      expect(parseDay("٢٠٢٦-٠٩-٣٠", false)).toBe(new Date(2026, 8, 30, 0, 0, 0).toISOString());
      expect(parseDay("2026-02-30", false)).toBeNull();
    });
  });

  describe("paging", () => {
    it("loads 50 at a time with Load more, passing the cursor", async () => {
      const first = Array.from({ length: 2 }, (_, i) => row({ userId: `a${i}`, username: `a${i}x`, displayName: `Person ${i}` }));
      const second = [row({ userId: "b0", username: "b0x", displayName: "Second page" })];
      const transport = fakePeopleTransport({
        pages: [page(first, { nextCursor: { k: "99.5", id: "a1" } }), page(second)],
      });
      await render(OFFICIAL, transport);
      await screen.findByTestId("person-row-a0");
      expect(screen.queryByTestId("person-row-b0")).toBeNull();
      await act(async () => {
        fireEvent.press(screen.getByTestId("people-load-more"));
      });
      expect(await screen.findByTestId("person-row-b0")).toBeTruthy();
      expect(screen.getByTestId("person-row-a0")).toBeTruthy();
      expect(lastQuery(transport)[1]).toEqual({ k: "99.5", id: "a1" });
      expect(screen.queryByTestId("people-load-more")).toBeNull();
    });
  });
});
