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
    expect(parseHomeExtras(null)).toEqual({ notice: null, pins: [] });
    expect(parseHomeExtras("x")).toEqual({ notice: null, pins: [] });
    expect(parseHomeExtras({ notice: null, pins: [] })).toEqual({
      notice: null,
      pins: [],
    });
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
    });
    expect(rpc).toHaveBeenCalledWith("home_extras", undefined, { get: true });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } } as never);
    await expect(SupabaseHomeExtrasTransport.fetchHomeExtras()).rejects.toEqual({
      message: "boom",
    });
  });
});
