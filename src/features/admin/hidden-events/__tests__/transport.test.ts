import { parseToolCounts } from "../../tools/transport";
import { CommunityError } from "@/features/community/types";

import {
  cleanHideNote,
  hideErrorKind,
  parseAdminHiddenEvents,
  parseHideCandidates,
  parseHideFoundEvents,
  parseHideImpact,
  parseHideResult,
  parseShowAgainResult,
} from "../transport";

const card = {
  event_id: "11111111-1111-1111-1111-111111111111",
  bumelerze_id: "bml2026x02",
  place: "12 km SW of Halabja",
  magnitude: 4.6,
  origin_time: "2026-11-26T08:15:00Z",
};
const keptCard = {
  event_id: "22222222-2222-2222-2222-222222222222",
  bumelerze_id: "bml2026x01",
  place: "10 km SW of Halabja",
  magnitude: "4.8",
  origin_time: "2026-11-26T08:14:40Z",
};

describe("Admin > Hidden earthquakes parsers (migration 0085)", () => {
  it("reads the hidden list with the reason, note, who and the card that stays", () => {
    const rows = parseAdminHiddenEvents([
      {
        ...card,
        status: "published",
        reason: "duplicate",
        note: "  ",
        hidden_at: "2026-11-27T09:00:00Z",
        hidden_by_name: "Peshawa",
        kept: keptCard,
      },
      {
        ...card,
        event_id: "e3",
        bumelerze_id: null,
        status: "possible",
        reason: "other",
        note: " Test by the station team ",
        hidden_at: "2026-11-27T10:00:00Z",
        kept: null,
      },
      { ...card, event_id: "e4", reason: "not_real", hidden_at: "not a date" },
      { event_id: "e5" },
      "junk",
    ]);
    expect(rows).toEqual([
      {
        eventId: card.event_id,
        bumelerzeId: "bml2026x02",
        place: "12 km SW of Halabja",
        magnitude: 4.6,
        originTime: Date.parse(card.origin_time),
        status: "published",
        reason: "duplicate",
        note: null,
        hiddenAt: Date.parse("2026-11-27T09:00:00Z"),
        hiddenByName: "Peshawa",
        kept: {
          eventId: keptCard.event_id,
          bumelerzeId: "bml2026x01",
          place: "10 km SW of Halabja",
          magnitude: 4.8,
          originTime: Date.parse(keptCard.origin_time),
          status: null,
        },
      },
      expect.objectContaining({
        eventId: "e3",
        bumelerzeId: null,
        status: "possible",
        reason: "other",
        note: "Test by the station team",
        hiddenByName: null,
        kept: null,
      }),
    ]);
    expect(parseAdminHiddenEvents(null)).toEqual([]);
  });

  it("reads a reason a newer server adds as Other", () => {
    const [row] = parseAdminHiddenEvents([
      { ...card, reason: "spam", hidden_at: "2026-11-27T09:00:00Z" },
    ]);
    expect(row?.reason).toBe("other");
  });

  it("reads the search with the Hidden flag (missing = not hidden)", () => {
    const rows = parseHideFoundEvents([
      { ...card, hidden: true, pinned_until: null },
      { ...card, event_id: "e2" },
      { ...card, event_id: "e3", hidden: "yes" },
      { bumelerze_id: "bml2026x09" },
    ]);
    expect(rows.map((row) => [row.eventId, row.hidden])).toEqual([
      [card.event_id, true],
      ["e2", false],
      ["e3", false],
    ]);
  });

  it("reads the candidates for the card that stays", () => {
    const rows = parseHideCandidates([
      { ...keptCard, distance_km: 12.4, minutes_apart: "0.3" },
      { ...keptCard, event_id: "e2", distance_km: null },
      { origin_time: "x" },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        eventId: keptCard.event_id,
        distanceKm: 12.4,
        minutesApart: 0.3,
      }),
      expect.objectContaining({ eventId: "e2", distanceKm: null, minutesApart: null }),
    ]);
  });

  it("reads what hiding would change, and falls back to nothing", () => {
    expect(
      parseHideImpact({ felt_reports: 12, safety_checkins: "3", on_home: true }),
    ).toEqual({
      feltReports: 12,
      safetyCheckins: 3,
      onHome: true,
    });
    expect(parseHideImpact(null)).toEqual({
      feltReports: 0,
      safetyCheckins: 0,
      onHome: false,
    });
    expect(parseHideImpact({ felt_reports: -1 })).toEqual({
      feltReports: 0,
      safetyCheckins: 0,
      onHome: false,
    });
  });

  it("reads the answers of hide and show again", () => {
    expect(
      parseHideResult({ moved_felt_reports: 7, moved_checkins: 1, unpinned: true }),
    ).toEqual({ movedFeltReports: 7, movedCheckins: 1, unpinned: true });
    expect(parseHideResult(null)).toEqual({
      movedFeltReports: 0,
      movedCheckins: 0,
      unpinned: false,
    });
    expect(
      parseShowAgainResult({ moved_back_felt_reports: 6, moved_back_checkins: 1 }),
    ).toEqual({ movedBackFeltReports: 6, movedBackCheckins: 1 });
  });

  it("sends the note as plain text: no direction controls, at most 200 characters", () => {
    expect(cleanHideNote("  ")).toBeNull();
    expect(cleanHideNote("‮blast‬ ")).toBe("blast");
    expect(cleanHideNote("x".repeat(250))).toHaveLength(200);
  });

  it("reads a possible earthquake: no Bumelerze id, place or magnitude", () => {
    const [row] = parseHideFoundEvents([
      {
        event_id: "e9",
        bumelerze_id: null,
        place: null,
        magnitude: null,
        origin_time: "2026-11-26T08:15:00Z",
        status: "possible",
        hidden: false,
      },
    ]);
    expect(row).toEqual({
      eventId: "e9",
      bumelerzeId: null,
      place: null,
      magnitude: null,
      originTime: Date.parse("2026-11-26T08:15:00Z"),
      status: "possible",
      hidden: false,
    });
  });

  it("names 0085's refusals: the card that stays, the note, and another admin first", () => {
    const err = (message: string) => new CommunityError("unknown", message);
    for (const name of [
      "kept_required",
      "kept_is_same",
      "kept_not_found",
      "kept_hidden",
    ]) {
      expect(hideErrorKind(err(`admin_hide_event: ${name}`))).toBe("kept");
    }
    for (const name of ["note_required", "note_too_long"]) {
      expect(hideErrorKind(err(`admin_hide_event: ${name}`))).toBe("note");
    }
    for (const message of [
      "admin_hide_event: bad_reason",
      "admin_hide_event: event_not_found",
      "admin_hide_event: already_hidden",
      "admin_unhide_event: not_hidden",
    ]) {
      expect(hideErrorKind(new CommunityError("not_found", message))).toBe("stale");
    }
    expect(
      hideErrorKind(new CommunityError("forbidden", "admin_hide_event: not_allowed")),
    ).toBeNull();
    expect(hideErrorKind("junk")).toBeNull();
    // A card that stays for another hidden earthquake (2.25), not a kept_* error.
    expect(hideErrorKind(err("admin_hide_event: is_kept_card"))).toBe("isKeptCard");
  });

  it("reads the launcher's count of hidden earthquakes (null before 0085)", () => {
    expect(parseToolCounts({ hidden_events: 4 }).hiddenEvents).toBe(4);
    expect(parseToolCounts({ accounts: 2 }).hiddenEvents).toBeNull();
  });
});

describe("SupabaseHiddenEventsAdminTransport (migration 0085)", () => {
  afterEach(() => {
    jest.dontMock("@/lib/supabase");
  });

  it("calls the six functions with the contract's parameters", async () => {
    jest.resetModules();
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    jest.doMock("@/lib/supabase", () => ({ getSupabaseClient: () => ({ rpc }) }));
    const { SupabaseHiddenEventsAdminTransport: transport } =
      await import("../transport");
    await transport.fetchHidden();
    await transport.findEvents("  bml2026x02 ");
    await transport.findEvents("   ");
    await transport.fetchCandidates("uuid-1");
    await transport.fetchImpact("uuid-1");
    await transport.hide({
      eventId: "uuid-1",
      reason: "duplicate",
      keptEventId: "uuid-2",
      note: null,
    });
    // The card that stays is sent for a second card only.
    await transport.hide({
      eventId: "uuid-3",
      reason: "not_real",
      keptEventId: "uuid-2",
      note: "Quarry blast",
    });
    await transport.showAgain("uuid-1");
    expect(rpc.mock.calls).toEqual([
      ["admin_hidden_events", undefined],
      ["admin_hide_find_events", { p_query: "bml2026x02", p_limit: 20 }],
      ["admin_hide_find_events", { p_query: null, p_limit: 20 }],
      ["admin_hide_candidates", { p_event_id: "uuid-1" }],
      ["admin_hide_impact", { p_event_id: "uuid-1" }],
      [
        "admin_hide_event",
        {
          p_event_id: "uuid-1",
          p_reason: "duplicate",
          p_kept_event_id: "uuid-2",
          p_note: null,
        },
      ],
      [
        "admin_hide_event",
        {
          p_event_id: "uuid-3",
          p_reason: "not_real",
          p_kept_event_id: null,
          p_note: "Quarry blast",
        },
      ],
      ["admin_unhide_event", { p_event_id: "uuid-1" }],
    ]);
  });

  it("turns 42501 into 'not allowed' and keeps the server's message for 22023", async () => {
    jest.resetModules();
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42501", message: "admin_hide_event: not allowed" },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "22023", message: "admin_hide_event: kept_required" },
      });
    jest.doMock("@/lib/supabase", () => ({ getSupabaseClient: () => ({ rpc }) }));
    const { SupabaseHiddenEventsAdminTransport: transport } =
      await import("../transport");
    const input = {
      eventId: "uuid-1",
      reason: "duplicate" as const,
      keptEventId: null,
      note: null,
    };
    await expect(transport.hide(input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(transport.hide(input)).rejects.toMatchObject({
      message: "admin_hide_event: kept_required",
    });
  });
});
