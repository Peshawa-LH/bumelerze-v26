import { cleanup, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";

import { AdminContent } from "../../components/AdminContent";
import { EMPTY_TOOL_COUNTS } from "../../tools/transport";
import { SourceStatusCard } from "../SourceStatusCard";
import { parseSourceStatus, type SourceStatusTransport } from "../transport";

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

const MINUTE = 60_000;
/** One reference time for every timestamp, so "2m ago" never reads 1m when
 * the clock ticks between two of them (the card measures from checked_at). */
const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** An answer of admin_source_status() as the server sends it (0072). */
function answer(
  over: { sources?: unknown[]; open_alerts?: unknown[]; shake_worker?: unknown } = {},
) {
  return {
    checked_at: iso(0),
    sources: over.sources ?? [
      source("usgs"),
      source("emsc"),
      source("geofon"),
      source("isc", { last_ok_at: iso(6 * 60 * MINUTE), threshold_minutes: 2940 }),
    ],
    open_alerts: over.open_alerts ?? [],
    shake_worker:
      "shake_worker" in over
        ? over.shake_worker
        : {
            token_set: true,
            pending: false,
            last_dispatched_at: iso(14 * MINUTE),
            last_outcome: "ok",
            last_status: 204,
            last_error: null,
            failures: 0,
          },
  };
}

function source(provider: string, over: Record<string, unknown> = {}) {
  return {
    provider,
    last_ok_at: iso(2 * MINUTE),
    last_error_at: null,
    last_error: null,
    late: false,
    threshold_minutes: 60,
    alert_opened_at: null,
    ...over,
  };
}

function transport(
  data: unknown,
): SourceStatusTransport & { fetchSourceStatus: jest.Mock } {
  return { fetchSourceStatus: jest.fn(async () => parseSourceStatus(data)) };
}

function lines(key: string): string[] {
  const row = screen.getByTestId(`admin-source-${key}`);
  return String(row.props.accessibilityLabel).split(": ").slice(1).join(": ").split(". ");
}

describe("Source status card (migrations 0070, 0072)", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows every feed with its last data and the SHAKEmap worker, all fine", async () => {
    await renderWithProviders(<SourceStatusCard transport={transport(answer())} />);
    expect(await screen.findByText("All sources are working")).toBeTruthy();
    expect(screen.getByText("Source status")).toBeTruthy();
    for (const key of ["usgs", "emsc", "geofon", "isc", "worker"]) {
      expect(screen.getByTestId(`admin-source-${key}`)).toBeTruthy();
    }
    expect(screen.getByText("ISC (daily bulletin)")).toBeTruthy();
    expect(screen.getAllByText("Last data: 2m ago")).toHaveLength(3);
    expect(screen.getByText("Last data: 6h ago")).toBeTruthy();
    expect(screen.getByText("SHAKEmap worker")).toBeTruthy();
    expect(screen.getByText("Last started: 14m ago")).toBeTruthy();
    expect(screen.getByTestId("admin-source-usgs").props.accessibilityLabel).toBe(
      "USGS: Last data: 2m ago",
    );
  });

  it("a late feed: when it last delivered, since when the alert is open, its last error", async () => {
    const data = answer({
      sources: [
        source("usgs"),
        source("emsc"),
        source("geofon", {
          last_ok_at: iso(160 * MINUTE),
          last_error_at: iso(1 * MINUTE),
          last_error: "The signal has been aborted",
          late: true,
          alert_opened_at: iso(90 * MINUTE),
        }),
        source("isc"),
      ],
      open_alerts: [
        {
          kind: "feed_stale",
          provider: "geofon",
          message: "x",
          opened_at: iso(90 * MINUTE),
        },
      ],
    });
    await renderWithProviders(<SourceStatusCard transport={transport(data)} />);
    expect(await screen.findByText("Need attention: 1")).toBeTruthy();
    expect(screen.getByText("Late. Last data: 2h ago")).toBeTruthy();
    expect(screen.getByText("Alert opened: 1h ago")).toBeTruthy();
    expect(screen.getByText("Last error: ⁨The signal has been aborted⁩")).toBeTruthy();
  });

  it("an error older than the last good fetch is not shown", async () => {
    const data = answer({
      sources: [
        source("usgs", {
          last_error_at: iso(30 * MINUTE),
          last_error: "old",
          late: false,
        }),
        source("emsc"),
        source("geofon"),
        source("isc"),
      ],
    });
    await renderWithProviders(<SourceStatusCard transport={transport(data)} />);
    await screen.findByText("All sources are working");
    expect(screen.queryByText(/Last error/)).toBeNull();
  });

  it("the worker without a token: not set up, quietly (the schedule still runs)", async () => {
    const data = answer({
      shake_worker: {
        token_set: false,
        pending: true,
        last_dispatched_at: null,
        last_outcome: "no_token",
        last_status: null,
        last_error: "No github_dispatch_token in Vault",
        failures: 0,
      },
    });
    await renderWithProviders(<SourceStatusCard transport={transport(data)} />);
    expect(
      await screen.findByText(
        "Not set up: no GitHub token yet. The schedule still runs.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("All sources are working")).toBeTruthy();
  });

  it("the worker failing: how many in a row and GitHub's last answer", async () => {
    const data = answer({
      shake_worker: {
        token_set: true,
        pending: true,
        last_dispatched_at: iso(3 * MINUTE),
        last_outcome: "failed",
        last_status: 401,
        last_error: 'GitHub 401: {"message":"Bad credentials"}',
        failures: 2,
      },
      open_alerts: [
        {
          kind: "shake_dispatch",
          provider: "github",
          message: "x",
          opened_at: iso(MINUTE),
        },
      ],
    });
    await renderWithProviders(<SourceStatusCard transport={transport(data)} />);
    expect(await screen.findByText("Need attention: 1")).toBeTruthy();
    expect(screen.getByText("Failed starts in a row: 2")).toBeTruthy();
    expect(screen.getByText("Last answer: ⁦GitHub 401⁩")).toBeTruthy();
  });

  it("the worker ready: a token, never started yet", async () => {
    const ready = answer({
      shake_worker: {
        token_set: true,
        pending: false,
        last_dispatched_at: null,
        last_outcome: null,
        last_status: null,
        last_error: null,
        failures: 0,
      },
    });
    await renderWithProviders(<SourceStatusCard transport={transport(ready)} />);
    expect(
      await screen.findByText("Ready: starts with the next earthquake"),
    ).toBeTruthy();
  });

  it("the worker started, waiting for GitHub, another start queued", async () => {
    const sent = answer({
      shake_worker: {
        token_set: true,
        pending: true,
        last_dispatched_at: iso(MINUTE),
        last_outcome: "sent",
        last_status: 204,
        last_error: null,
        failures: 0,
      },
    });
    await renderWithProviders(<SourceStatusCard transport={transport(sent)} />);
    expect(
      await screen.findByText("Started: 1m ago. Waiting for GitHub's answer"),
    ).toBeTruthy();
    expect(screen.getByText("A new start is waiting")).toBeTruthy();
  });

  it("before 0072: no worker row", async () => {
    await renderWithProviders(
      <SourceStatusCard transport={transport(answer({ shake_worker: undefined }))} />,
    );
    await screen.findByText("All sources are working");
    expect(screen.queryByTestId("admin-source-worker")).toBeNull();
  });

  it("before 0070 (no such function): says it could not load", async () => {
    const failing = {
      fetchSourceStatus: jest.fn(async () => Promise.reject(new Error("PGRST202"))),
    };
    await renderWithProviders(<SourceStatusCard transport={failing} />);
    expect(
      await screen.findByText("The source status could not be loaded."),
    ).toBeTruthy();
  });

  it("an open alert of another kind still counts", async () => {
    const data = answer({
      open_alerts: [
        { kind: "something_new", provider: null, message: "x", opened_at: iso(MINUTE) },
      ],
    });
    await renderWithProviders(<SourceStatusCard transport={transport(data)} />);
    expect(await screen.findByText("Need attention: 1")).toBeTruthy();
  });

  it("Sorani: right to left, Eastern Arabic-Indic digits, Latin error isolated", async () => {
    await i18n.changeLanguage("ckb");
    const data = answer({
      sources: [
        source("usgs"),
        source("emsc", {
          last_ok_at: iso(70 * MINUTE),
          late: true,
          last_error_at: iso(MINUTE),
          last_error: "request failed: 502",
        }),
        source("geofon"),
        source("isc"),
      ],
    });
    await renderWithProviders(<SourceStatusCard transport={transport(data)} />);
    expect(await screen.findByText("پێویستیان بە سەرنجە: ١")).toBeTruthy();
    const title = screen.getByText("دۆخی سەرچاوەکان");
    expect(title.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ writingDirection: "rtl" })]),
    );
    expect(screen.getAllByText("دوایین زانیاری: ٢ خولەک لەمەوبەر")).toHaveLength(3);
    expect(
      screen.getByText("دواکەوتووە. دوایین زانیاری: ١ کاتژمێر لەمەوبەر"),
    ).toBeTruthy();
    expect(screen.getByText("دوایین هەڵە: ⁨request failed: 502⁩")).toBeTruthy();
    expect(lines("worker")).toEqual(["دوایین دەستپێکردن: ١٤ خولەک لەمەوبەر"]);
  });
});

describe("parseSourceStatus", () => {
  it("skips broken rows and reads times as epoch milliseconds", () => {
    const parsed = parseSourceStatus({
      checked_at: "2026-10-22T10:00:00Z",
      sources: [
        source("usgs", { last_ok_at: "2026-10-22T09:58:00Z" }),
        { provider: "nope" },
        "junk",
      ],
      open_alerts: [{ kind: "feed_stale", provider: "isc", opened_at: "bad" }],
    });
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0]?.lastOkAt).toBe(Date.parse("2026-10-22T09:58:00Z"));
    expect(parsed.openAlerts).toEqual([]);
    expect(parsed.worker).toBeNull();
    expect(parsed.checkedAt).toBe(Date.parse("2026-10-22T10:00:00Z"));
  });

  it("an empty or missing answer is an empty status, never a crash", () => {
    expect(parseSourceStatus(null)).toEqual({
      checkedAt: null,
      sources: [],
      openAlerts: [],
      worker: null,
    });
  });
});

describe("on the admin home", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  const counts = { fetchToolCounts: jest.fn(async () => EMPTY_TOOL_COUNTS) };

  async function home(permissions: Permission[], sources = transport(answer())) {
    const hub = makeTransport({ permissions: [] });
    hub.fetchMyPermissions.mockResolvedValue(permissions);
    await renderWithProviders(
      <AdminContent
        hubTransport={hub}
        countsTransport={counts}
        sourcesTransport={sources}
      />,
    );
    return sources;
  }

  it("statistics ranks see it above the tiles", async () => {
    await home(["stats.read", "comments.moderate"]);
    expect(await screen.findByTestId("admin-sources")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("All sources are working")).toBeTruthy());
    expect(screen.getByTestId("admin-tiles")).toBeTruthy();
  });

  it("a moderator without stats.read never asks for it", async () => {
    const sources = await home(["comments.moderate"]);
    await screen.findByTestId("admin-tiles");
    expect(screen.queryByTestId("admin-sources")).toBeNull();
    expect(sources.fetchSourceStatus).not.toHaveBeenCalled();
  });
});
