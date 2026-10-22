// The three live channel adapters driven end to end through a fake `fetch`
// (zod reaches Jest through jest.config.js's `npm:zod` mapping). Pinned
// here: an agency saying "no matching events" with an EMPTY body (204, or a
// blank 200) is zero events for every channel, never a failed run — the
// review's finding D-9: `JSON.parse("")` used to throw on the EMSC path and
// turn a quiet feed into a 502 on every poll.

import { fetchEmscChannel } from "../emsc-adapter";
import { fetchGeofonChannel } from "../geofon-adapter";
import { buildIscUrl, fetchIscChannel, fdsnUtcTime } from "../isc-adapter";
import { fetchUsgsChannel } from "../usgs-adapter";

const BBOX = { minLat: 33.0, maxLat: 38.5, minLon: 41.0, maxLon: 48.5 };
const SINCE = Date.parse("2026-10-11T18:00:00Z");

// Real features, verified live 2026-08-27 / 2026-10-14.
const USGS_FEATURE = {
  type: "Feature",
  id: "us6000tnbh",
  properties: {
    mag: 4.2,
    place: "5 km SSE of Darreh Shahr, Iran",
    time: 1787638792919,
    updated: 1787640174040,
    magType: "mb",
    net: "us",
    status: "reviewed",
  },
  geometry: { type: "Point", coordinates: [47.3976, 33.101, 10] },
};

const EMSC_FEATURE = {
  type: "Feature",
  id: "20261014_0000268",
  geometry: { type: "Point", coordinates: [42.425, 37.0598, -5.9] },
  properties: {
    source_id: "2074761",
    source_catalog: "EMSC-RTS",
    lastupdate: "2026-10-14T15:44:29.441194Z",
    time: "2026-10-14T15:00:33.21Z",
    flynn_region: "TURKEY-SYRIA-IRAQ BORDER REGION",
    lat: 37.0598,
    lon: 42.425,
    depth: 5.9,
    evtype: "ke",
    auth: "EMSC",
    mag: 2.0,
    magtype: "ml",
    unid: "20261014_0000268",
  },
};

const GEOFON_TEXT = [
  "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType",
  "gfz2026qprg|2026-08-25T06:19:54.11|33.176|47.599|10.0|||GFZ|gfz2026qprg|mb|4.3||Western Iran|earthquake",
].join("\n");

function respond(status: number, body: string): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }) as unknown as typeof fetch;
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("EMSC channel", () => {
  it("reads a real feature collection", async () => {
    respond(200, JSON.stringify({ type: "FeatureCollection", features: [EMSC_FEATURE] }));

    const result = await fetchEmscChannel(BBOX, SINCE);

    expect(result.channel).toBe("emsc");
    expect(result.emptyBody).toBe(false);
    expect(result.skippedCount).toBe(0);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      provider: "emsc",
      providerEventId: "20261014_0000268",
      magnitude: 2.0,
      place: "TURKEY-SYRIA-IRAQ BORDER REGION",
    });
  });

  it("treats 204 No Content as zero events (D-9), not a failed channel", async () => {
    respond(204, "");

    await expect(fetchEmscChannel(BBOX, SINCE)).resolves.toEqual({
      channel: "emsc",
      records: [],
      skippedCount: 0,
      emptyBody: true,
    });
  });

  it("treats a blank 200 body the same way", async () => {
    respond(200, "\n");

    const result = await fetchEmscChannel(BBOX, SINCE);
    expect(result.records).toEqual([]);
    expect(result.emptyBody).toBe(true);
  });

  it("an empty feature list is zero events too, but says so with a body", async () => {
    respond(200, JSON.stringify({ type: "FeatureCollection", features: [] }));

    const result = await fetchEmscChannel(BBOX, SINCE);
    expect(result.records).toEqual([]);
    expect(result.emptyBody).toBe(false);
  });

  it("still fails the channel on a body that is not JSON", async () => {
    respond(200, "<html>maintenance</html>");

    await expect(fetchEmscChannel(BBOX, SINCE)).rejects.toThrow();
  });

  it("still fails the channel on a non-2xx status", async () => {
    respond(500, "");

    await expect(fetchEmscChannel(BBOX, SINCE)).rejects.toThrow(/500/);
  });
});

describe("USGS channel", () => {
  it("reads a real feature collection", async () => {
    respond(200, JSON.stringify({ type: "FeatureCollection", features: [USGS_FEATURE] }));

    const result = await fetchUsgsChannel(BBOX, SINCE);

    expect(result.channel).toBe("usgs");
    expect(result.emptyBody).toBe(false);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      provider: "usgs",
      providerEventId: "us6000tnbh",
    });
  });

  it("treats 204 No Content as zero events (D-9)", async () => {
    respond(204, "");

    await expect(fetchUsgsChannel(BBOX, SINCE)).resolves.toEqual({
      channel: "usgs",
      records: [],
      skippedCount: 0,
      emptyBody: true,
    });
  });

  it("reads USGS's usual quiet answer, an empty collection, as zero events with a body", async () => {
    respond(200, JSON.stringify({ type: "FeatureCollection", features: [] }));

    const result = await fetchUsgsChannel(BBOX, SINCE);
    expect(result.records).toEqual([]);
    expect(result.emptyBody).toBe(false);
  });
});

describe("GEOFON channel (FDSN text)", () => {
  it("reads a real text bulletin", async () => {
    respond(200, GEOFON_TEXT);

    const result = await fetchGeofonChannel(BBOX, SINCE);

    expect(result.channel).toBe("geofon");
    expect(result.emptyBody).toBe(false);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      provider: "geofon",
      providerEventId: "gfz2026qprg",
    });
  });

  it("treats 204 No Content (GEOFON's usual answer for this region) as zero events", async () => {
    respond(204, "");

    await expect(fetchGeofonChannel(BBOX, SINCE)).resolves.toEqual({
      channel: "geofon",
      records: [],
      skippedCount: 0,
      emptyBody: true,
    });
  });
});

// Real lines of the ISC bulletin, verified live 2026-10-22 (the header, two
// rows and the trailing agency key ISC appends).
const ISC_TEXT = [
  "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType",
  "646583552|2025-07-29T12:03:11.600|34.2000|48.1380|5.0|TEH|TEH|TEH|640089845|ML|2.30|TEH|Western Iran|earthquake",
  "643913511|2025-07-30T21:43:51.100|36.4790|45.6540|33.1|ISN|ISN|ISN|638344921|ML|2.10|ISN|Iran-Iraq border region|earthquake",
  "",
  "# Agencies whose data contributed to this bulletin",
  "# ISN       Iraqi Seismic Network                                                            Iraq",
].join("\n");

// What ISC answered every day from 2026-09-27 to 2026-10-22: an error page
// with HTTP 200, because the start time ended in "Z".
const ISC_ERROR_PAGE = [
  "Error 400: Bad Request:",
  "The value 2025-07-29 09:52:52.642Z for starttime is invalid.",
  "",
  "YYYY-MM-DDThh:mm:ss[.ssssss] ex. 1997-01-31T12:04:32.123",
].join("\n");

describe("ISC channel (FDSN text, daily bulletin)", () => {
  it("asks with a start time ISC accepts: UTC, no zone letter, no fraction", () => {
    expect(fdsnUtcTime(Date.parse("2025-07-29T09:52:52.642Z"))).toBe(
      "2025-07-29T09:52:52",
    );
    const url = new URL(buildIscUrl(BBOX, Date.parse("2025-07-29T09:52:52.642Z")));
    expect(url.searchParams.get("starttime")).toBe("2025-07-29T09:52:52");
    expect(url.searchParams.get("format")).toBe("text");
    expect(url.searchParams.get("minlatitude")).toBe("33");
    expect(url.searchParams.get("maxlongitude")).toBe("48.5");
  });

  it("reads the bulletin, skipping the header and the agency key", async () => {
    respond(200, ISC_TEXT);

    const result = await fetchIscChannel(BBOX, SINCE);

    expect(result.channel).toBe("isc");
    expect(result.skippedCount).toBe(0);
    expect(
      result.records.map((r) => [r.providerEventId, r.authorAgency, r.reviewStatus]),
    ).toEqual([
      ["646583552", "TEH", "reviewed"],
      ["643913511", "ISN", "reviewed"],
    ]);
    expect(result.records[0]?.originTimeMs).toBe(Date.parse("2025-07-29T12:03:11.600Z"));
  });

  it("fails the channel on an error page sent with HTTP 200, instead of reporting zero events", async () => {
    respond(200, ISC_ERROR_PAGE);

    await expect(fetchIscChannel(BBOX, SINCE)).rejects.toThrow(
      "not an FDSN text answer: Error 400: Bad Request:",
    );
  });

  it("still reads 204 No Content as zero events", async () => {
    respond(204, "");

    await expect(fetchIscChannel(BBOX, SINCE)).resolves.toEqual({
      channel: "isc",
      records: [],
      skippedCount: 0,
      emptyBody: true,
    });
  });
});

describe("FDSN text answers that are not a bulletin", () => {
  it("GEOFON: an HTML page with a 2xx status fails the channel too", async () => {
    respond(200, "<html><head><title>Processing Failed</title></head></html>");

    await expect(fetchGeofonChannel(BBOX, SINCE)).rejects.toThrow(
      "not an FDSN text answer: <html>",
    );
  });

  it("GEOFON: a header with no rows is zero events, not an error", async () => {
    respond(200, `${GEOFON_TEXT.split("\n")[0]}\n`);

    const result = await fetchGeofonChannel(BBOX, SINCE);

    expect(result.records).toEqual([]);
    expect(result.skippedCount).toBe(0);
    expect(result.emptyBody).toBe(false);
  });
});
