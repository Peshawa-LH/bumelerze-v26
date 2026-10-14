import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { StatsContent } from "../StatsContent";
import { parseStats, type StatsTransport } from "../transport";
import type { AdminStats, StatsRange } from "../types";

/** The text of an element without the direction isolates around numbers. */
function plain(testID: string): string {
  const collect = (node: unknown): string => {
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(collect).join("");
    const children = (node as { props?: { children?: unknown } } | null)?.props?.children;
    return children === undefined ? "" : collect(children);
  };
  return collect(screen.getByTestId(testID)).replace(/[\u2066-\u2069]/g, "");
}

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "admin-1" }),
}));

const mockHub = makeTransport({ permissions: [] });

const RAW = {
  from: "2026-10-12",
  to: "2026-10-14",
  step: "day",
  days: 30,
  totals: { accounts: 1284, accounts_new: 194, felt: 75, checkins: 91, waiting: 7 },
  series: [
    {
      date: "2026-10-12",
      accounts: 3,
      felt: 2,
      checkins: 0,
      comments: 4,
      waiting: 1,
      devices: { web: 3, ios: 5, android: 6, other: 0 },
    },
    {
      date: "2026-10-13",
      accounts: 5,
      felt: 38,
      checkins: 80,
      comments: 30,
      waiting: 2,
      devices: { web: 3, ios: 5, android: 6, other: 0 },
    },
    {
      date: "2026-10-14",
      accounts: 1,
      felt: 1,
      checkins: 11,
      comments: 2,
      waiting: 0,
      devices: { web: 3, ios: 5, android: 6, other: 0 },
    },
  ],
  buildings: {
    homes: 350,
    classes: { A: 46, B: 88, C: 131, D: 64, E: 17, F: 4 },
    areas: [
      { area: "sulaymaniyah", homes: 142 },
      { area: "other", homes: 23 },
    ],
  },
};

function transport(data: AdminStats = parseStats(RAW)) {
  return {
    fetchStats: jest.fn(async (_range: StatsRange) => data),
  } satisfies StatsTransport;
}

async function render(permissions: Permission[], t = transport()) {
  mockHub.fetchMyPermissions.mockResolvedValue(permissions);
  await renderWithProviders(<StatsContent transport={t} hubTransport={mockHub} />);
  return t;
}

describe("Admin > Statistics (review 15.2, mockup 5b)", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("shows four headline numbers and six charts for 30 days by default", async () => {
    const t = await render(["stats.read"]);
    expect(await screen.findByTestId("stats-headline")).toBeTruthy();
    expect(t.fetchStats).toHaveBeenCalledWith(30);
    expect(plain("stats-accounts")).toBe("1,284accounts+194 in this range");
    expect(plain("stats-felt")).toBe("75felt reportsBusiest: 13 Oct (38)");
    expect(plain("stats-checkins")).toBe("91I'm safe check-ins");
    expect(plain("stats-waiting")).toBe("7waiting for review");
    for (const id of ["accounts", "felt", "checkins", "comments"]) {
      expect(screen.getByTestId(`stats-chart-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId("stats-buildings")).toBeTruthy();
    expect(plain("stats-devices")).toContain("Now: iPhone 5 · Android 6 · Web 3");
  });

  it("names every vulnerability class with its letter and name, never colour alone", async () => {
    await render(["stats.read"]);
    await screen.findByTestId("stats-vc-A");
    expect(plain("stats-vc-A")).toBe("AMost vulnerable46");
    expect(plain("stats-vc-F")).toBe("FStrongest4");
    expect(screen.getByTestId("stats-vc-C").props.accessibilityLabel).toBe(
      "Class C, Somewhat vulnerable: ⁦131⁩",
    );
    expect(plain("stats-areas")).toMatch(/^By area: .+ 142 · Other areas 23$/);
  });

  it("switches the range with the chips (7, 30, 90 days, All)", async () => {
    const t = await render(["stats.read"]);
    await screen.findByTestId("stats-headline");
    await act(async () => {
      fireEvent.press(screen.getByTestId("stats-range-7"));
    });
    await waitFor(() => expect(t.fetchStats).toHaveBeenCalledWith(7));
    await act(async () => {
      fireEvent.press(screen.getByTestId("stats-range-all"));
    });
    await waitFor(() => expect(t.fetchStats).toHaveBeenCalledWith("all"));
    expect(screen.getByTestId("stats-range-all").props.accessibilityState.selected).toBe(
      true,
    );
  });

  it("says it holds counts only", async () => {
    await render(["stats.read"]);
    expect(await screen.findByTestId("stats-page-footer")).toHaveTextContent(
      "Counts only. No names, locations or device IDs on this page.",
    );
  });

  it("shows nothing without stats.read, and never asks the server", async () => {
    const t = await render(["comments.moderate"]);
    expect(await screen.findByTestId("stats-no-access")).toBeTruthy();
    expect(t.fetchStats).not.toHaveBeenCalled();
  });

  it("uses Eastern Arabic-Indic digits and Sorani names in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    await render(["stats.read"]);
    await screen.findByTestId("stats-accounts");
    expect(plain("stats-accounts")).toContain("١,٢٨٤");
    expect(screen.getByTestId("stats-range-7")).toHaveTextContent(/٧/);
  });
});

describe("parseStats", () => {
  it("reads the server's answer and fills missing classes with 0", () => {
    const parsed = parseStats({
      ...RAW,
      buildings: { homes: 1, classes: { C: 1 }, areas: [] },
    });
    expect(parsed.buildings.classes).toEqual({ A: 0, B: 0, C: 1, D: 0, E: 0, F: 0 });
    expect(parsed.series).toHaveLength(3);
    expect(parsed.totals.accountsNew).toBe(194);
  });

  it("refuses a broken answer", () => {
    expect(() => parseStats({})).toThrow();
  });
});
