import { parseHomeExtras } from "../transport";

const row = {
  event_id: "11111111-1111-1111-1111-111111111111",
  bumelerze_id: "bml2026x01",
  origin_time: "2026-11-23T08:15:00Z",
  lat: 35.18,
  lon: 45.98,
  depth_km: 12,
  magnitude: 4.6,
  mag_type: "mb",
  place: "12 km SW of Halabja",
  updated_at: "2026-11-23T09:00:00Z",
  pinned_at: "2026-11-25T10:00:00Z",
  ends_at: "2026-11-28T10:00:00Z",
  sources: [
    {
      provider: "emsc",
      provider_event_id: "20261123_0000123",
      fetched_at: "2026-11-23T08:20:00Z",
    },
    {
      provider: "usgs",
      provider_event_id: "us7000abcd",
      fetched_at: "2026-11-23T08:25:00Z",
    },
  ],
};

describe("parseHomeExtras (home_extras(), migration 0084)", () => {
  it("reads the message with only the languages filled in", () => {
    const out = parseHomeExtras({
      notice: {
        notice_id: "n1",
        kind: "important",
        texts: { en: "Stay away from damaged buildings.", ckb: "لە بیناکان دوور بکەوە" },
        starts_at: "2026-11-25T10:00:00Z",
        ends_at: "2026-11-26T10:00:00Z",
      },
      pins: [],
    });
    expect(out.notice).toEqual({
      id: "n1",
      kind: "important",
      texts: { en: "Stay away from damaged buildings.", ckb: "لە بیناکان دوور بکەوە" },
      startsAt: Date.parse("2026-11-25T10:00:00Z"),
      endsAt: Date.parse("2026-11-26T10:00:00Z"),
    });
  });

  it("reads an unknown kind as information and drops a message with no text", () => {
    const base = {
      notice_id: "n1",
      starts_at: "2026-11-25T10:00:00Z",
      ends_at: "2026-11-26T10:00:00Z",
    };
    expect(
      parseHomeExtras({ notice: { ...base, kind: "urgent", texts: { en: "x" } } }).notice
        ?.kind,
    ).toBe("info");
    expect(
      parseHomeExtras({ notice: { ...base, kind: "info", texts: {} } }).notice,
    ).toBeNull();
    expect(
      parseHomeExtras({ notice: { ...base, kind: "info", texts: { en: "  " } } }).notice,
    ).toBeNull();
  });

  it("builds a chosen earthquake from the registry row, first-seen record first", () => {
    const out = parseHomeExtras({ notice: null, pins: [row] });
    expect(out.pins).toHaveLength(1);
    const pin = out.pins[0]!;
    expect(pin.registryId).toBe(row.event_id);
    expect(pin.providerIds).toEqual(["20261123_0000123", "us7000abcd"]);
    expect(pin.endsAt).toBe(Date.parse(row.ends_at));
    expect(pin.event).toMatchObject({
      id: "20261123_0000123",
      bumelerzeId: "bml2026x01",
      originTime: Date.parse(row.origin_time),
      lat: 35.18,
      lon: 45.98,
      depthKm: 12,
      magnitude: { value: 4.6, type: "mb" },
      provenance: { provider: "emsc", providerId: "20261123_0000123" },
      isRegional: true,
    });
  });

  it("uses the registry id when no provider record is known", () => {
    const out = parseHomeExtras({ pins: [{ ...row, sources: [] }] });
    expect(out.pins[0]?.event.id).toBe(row.event_id);
    expect(out.pins[0]?.providerIds).toEqual([]);
  });

  it("leaves out a row it cannot read and keeps at most three", () => {
    const out = parseHomeExtras({
      pins: [row, { ...row, lat: 200 }, row, row, row],
    });
    expect(out.pins).toHaveLength(3);
  });

  it("reads nothing from an empty or odd answer", () => {
    expect(parseHomeExtras(null)).toEqual({ notice: null, pins: [], hidden: [] });
    expect(parseHomeExtras("x")).toEqual({ notice: null, pins: [], hidden: [] });
    expect(parseHomeExtras({ notice: null, pins: [] })).toEqual({
      notice: null,
      pins: [],
      hidden: [],
    });
  });
});

describe("parseHomeExtras: hidden earthquakes (migration 0085)", () => {
  const kept = { bumelerze_id: "bml2026x01", provider_ids: ["us7000abcd"] };

  it("reads a second card with the card that stays, and a removed one", () => {
    const out = parseHomeExtras({
      notice: null,
      pins: [],
      hidden: [
        {
          bumelerze_id: "bml2026x02",
          provider_ids: ["20261123_0000123", "gfz2026abcd"],
          reason_kind: "duplicate",
          kept,
        },
        {
          bumelerze_id: "bml2026x03",
          provider_ids: ["us7000zzzz"],
          reason_kind: "removed",
          kept: null,
        },
      ],
    });
    expect(out.hidden).toEqual([
      {
        bumelerzeId: "bml2026x02",
        providerIds: ["20261123_0000123", "gfz2026abcd"],
        reasonKind: "duplicate",
        kept: { bumelerzeId: "bml2026x01", providerIds: ["us7000abcd"] },
      },
      {
        bumelerzeId: "bml2026x03",
        providerIds: ["us7000zzzz"],
        reasonKind: "removed",
        kept: null,
      },
    ]);
  });

  it("keeps the old answer (26.5.0-26.5.1 servers) working: no key, an empty list", () => {
    expect(parseHomeExtras({ notice: null, pins: [row] }).hidden).toEqual([]);
    expect(parseHomeExtras({ notice: null, pins: [], hidden: "x" }).hidden).toEqual([]);
  });

  it("drops rows it cannot read, never throwing", () => {
    const out = parseHomeExtras({
      hidden: [
        null,
        "bml2026x09",
        { provider_ids: ["us1"] }, // no reason_kind
        { bumelerze_id: null, provider_ids: [], reason_kind: "removed" }, // no id at all
        {
          bumelerze_id: 7,
          provider_ids: [3, "", "  ", "emsc-1"],
          reason_kind: "removed",
        },
        { bumelerze_id: "bml2026x05", provider_ids: "junk", reason_kind: "removed" },
      ],
    });
    expect(out.hidden).toEqual([
      { bumelerzeId: null, providerIds: ["emsc-1"], reasonKind: "removed", kept: null },
      { bumelerzeId: "bml2026x05", providerIds: [], reasonKind: "removed", kept: null },
    ]);
  });

  it("reads a second card with no readable card that stays, or an unknown kind, as removed: still hidden", () => {
    const out = parseHomeExtras({
      hidden: [
        {
          bumelerze_id: "bml2026x06",
          provider_ids: [],
          reason_kind: "duplicate",
          kept: null,
        },
        {
          bumelerze_id: "bml2026x07",
          provider_ids: [],
          reason_kind: "duplicate",
          kept: { bumelerze_id: null, provider_ids: [] },
        },
        { bumelerze_id: "bml2026x08", provider_ids: [], reason_kind: "spam", kept },
      ],
    });
    expect(out.hidden.map((entry) => [entry.reasonKind, entry.kept])).toEqual([
      ["removed", null],
      ["removed", null],
      ["removed", null],
    ]);
  });
});

describe("SupabaseHomeExtrasTransport", () => {
  it("asks home_extras() as a GET read and throws on a server error", async () => {
    const rpc = jest.fn(async () => ({ data: { notice: null, pins: [] }, error: null }));
    jest.resetModules();
    jest.doMock("@/lib/supabase", () => ({ getSupabaseClient: () => ({ rpc }) }));
    const { SupabaseHomeExtrasTransport } = await import("../transport");
    await expect(SupabaseHomeExtrasTransport.fetchHomeExtras()).resolves.toEqual({
      notice: null,
      pins: [],
      hidden: [],
    });
    expect(rpc).toHaveBeenCalledWith("home_extras", undefined, { get: true });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never);
    await expect(SupabaseHomeExtrasTransport.fetchHomeExtras()).rejects.toEqual({
      message: "boom",
    });
  });
});
