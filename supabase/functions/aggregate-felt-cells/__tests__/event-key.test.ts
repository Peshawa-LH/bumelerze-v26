/**
 * Unit tests for `classifyAggregateRequest` (migration 0011: the function
 * accepts EITHER a canonical `eventId` uuid OR a (provider,
 * providerEventId) pair). Same "pure decision logic, no zod/Deno
 * dependency, run under Jest" pattern as `aggregate-event.test.ts` — see
 * `event-key.ts`'s own doc comment.
 */

import { classifyAggregateRequest } from "../event-key";

describe("classifyAggregateRequest", () => {
  it("classifies a bare eventId as single-by-id", () => {
    const result = classifyAggregateRequest({ eventId: "evt-uuid-1" });
    expect(result).toEqual({
      ok: true,
      request: { mode: "single-by-id", eventId: "evt-uuid-1" },
    });
  });

  it("classifies a (provider, providerEventId) pair as single-by-provider", () => {
    const result = classifyAggregateRequest({
      provider: "usgs",
      providerEventId: "us1000abcd",
    });
    expect(result).toEqual({
      ok: true,
      request: {
        mode: "single-by-provider",
        provider: "usgs",
        providerEventId: "us1000abcd",
      },
    });
  });

  it("classifies an empty body as sweep with the default lookback", () => {
    const result = classifyAggregateRequest({});
    expect(result).toEqual({ ok: true, request: { mode: "sweep", sinceHours: 24 } });
  });

  it("classifies sinceHours-only as sweep with the given lookback", () => {
    const result = classifyAggregateRequest({ sinceHours: 48 });
    expect(result).toEqual({ ok: true, request: { mode: "sweep", sinceHours: 48 } });
  });

  it("rejects provider without providerEventId", () => {
    const result = classifyAggregateRequest({ provider: "usgs" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/provider and providerEventId must be supplied together/);
  });

  it("rejects providerEventId without provider", () => {
    const result = classifyAggregateRequest({ providerEventId: "us1000abcd" });
    expect(result.ok).toBe(false);
  });

  it("rejects eventId combined with provider/providerEventId (ambiguous)", () => {
    const result = classifyAggregateRequest({
      eventId: "evt-uuid-1",
      provider: "usgs",
      providerEventId: "us1000abcd",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/mutually exclusive/);
  });

  it("eventId takes no notice of sinceHours (single-event mode ignores sweep-only fields)", () => {
    const result = classifyAggregateRequest({ eventId: "evt-uuid-1", sinceHours: 12 });
    expect(result).toEqual({
      ok: true,
      request: { mode: "single-by-id", eventId: "evt-uuid-1" },
    });
  });
});
