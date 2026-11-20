/**
 * The ISC window starts at max(ISC_START, now - 450 days) and never in the
 * future (owner decision 2026-11-20: ISC from now on only, no backfill);
 * the live channels keep their 72-hour window.
 */
import { CHANNELS, ISC_START_MS, iscWindowStartMs } from "../channels";

const DAY = 24 * 60 * 60 * 1000;

describe("ISC window", () => {
  it("starts on 2026-11-21 00:00 UTC", () => {
    expect(ISC_START_MS).toBe(Date.parse("2026-11-21T00:00:00Z"));
  });

  it.each([
    ["the first daily run", "2026-11-21T03:17:00Z"],
    ["a month later", "2026-12-21T03:17:00Z"],
    ["a year later", "2027-11-21T03:17:00Z"],
    ["the last day before 450 days have passed", "2028-02-13T23:59:59Z"],
  ])("asks from ISC_START on %s (no backfill)", (_label, now) => {
    expect(iscWindowStartMs(Date.parse(now))).toBe(ISC_START_MS);
  });

  it("once ISC_START is more than 450 days behind, keeps the rolling 450-day window", () => {
    const now = ISC_START_MS + 500 * DAY;
    expect(iscWindowStartMs(now)).toBe(now - 450 * DAY);
    expect(iscWindowStartMs(now)).toBeGreaterThan(ISC_START_MS);
  });

  it("never starts in the future (a run before ISC_START asks from now)", () => {
    const now = Date.parse("2026-11-20T21:00:00Z");
    expect(iscWindowStartMs(now)).toBe(now);
  });
});

describe("the channels' requests", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function capture() {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;
    return () => new URL(String(fetchMock.mock.calls[0]?.[0]));
  }

  it("ISC sends starttime=2026-11-21T00:00:00 on the first run, and 204 is zero events", async () => {
    const url = capture();
    const result = await CHANNELS.isc.fetch(Date.parse("2026-11-21T03:17:00Z"));
    expect(url().searchParams.get("starttime")).toBe("2026-11-21T00:00:00");
    expect(result).toEqual({
      channel: "isc",
      records: [],
      skippedCount: 0,
      emptyBody: true,
    });
  });

  it("ISC still sends ISC_START a year later", async () => {
    const url = capture();
    await CHANNELS.isc.fetch(Date.parse("2027-11-30T03:17:00Z"));
    expect(url().searchParams.get("starttime")).toBe("2026-11-21T00:00:00");
  });

  it("GEOFON keeps its 72-hour window (only ISC changed)", async () => {
    const url = capture();
    const now = Date.parse("2026-11-21T03:17:00Z");
    await CHANNELS.geofon.fetch(now);
    expect(Date.parse(url().searchParams.get("starttime") ?? "")).toBe(now - 3 * DAY);
  });
});
