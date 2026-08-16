import * as fs from "node:fs";
import * as path from "node:path";

import type {
  EventRegistration,
  FeltLocation,
  Tier1Report,
  Tier2Answers,
  Tier2Report,
} from "../types";

/**
 * `SupabaseTransport` — no real network call anywhere in this file
 * (wave brief: "no real network calls in tests"). `getSupabaseClient` is
 * mocked at the `@/lib/supabase` seam (already unit-tested on its own in
 * `src/lib/__tests__/supabase.test.ts`), so this file only has to prove
 * `SupabaseTransport` calls it correctly and maps queue items to the exact
 * insert payloads the migration expects.
 *
 * The "sync-check" tests below parse `supabase/migrations/0003_felt_reports.sql`
 * itself (plain regex over the `create table` column list — no SQL parser
 * dependency) and assert every key this module sends is a REAL column name
 * in that file. This is what keeps the client-side mapping and the DB schema
 * from silently drifting apart if either changes later without the other.
 */

function extractTableColumns(sql: string, tableName: string): string[] {
  const startMarker = `create table public.${tableName} (`;
  const startIdx = sql.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(
      `extractTableColumns: table "${tableName}" not found in migration SQL`,
    );
  }
  const bodyStart = startIdx + startMarker.length;
  const endIdx = sql.indexOf("\n);", bodyStart);
  if (endIdx === -1) {
    throw new Error(`extractTableColumns: no closing ");" found for "${tableName}"`);
  }
  const body = sql.slice(bodyStart, endIdx);

  const columns: string[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("--")) {
      continue;
    }
    if (/^(unique|primary key|check|constraint|foreign key)/i.test(line)) {
      continue;
    }
    const match = /^([a-z_][a-z0-9_]*)\s+/i.exec(line);
    if (match?.[1]) {
      columns.push(match[1]);
    }
  }
  return columns;
}

function loadMigrationColumns(tableName: string): string[] {
  const sqlPath = path.join(
    __dirname,
    "../../../../supabase/migrations/0003_felt_reports.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf8");
  return extractTableColumns(sql, tableName);
}

/** Same schema/app sync-check idea as `loadMigrationColumns`, but for
 * 0009's `alter table ... add column <name> ...` statements instead of a
 * `create table` column list (a different SQL shape needs a different, still
 * dependency-free, regex pass). */
function loadMigrationColumns0009(): string[] {
  const sqlPath = path.join(
    __dirname,
    "../../../../supabase/migrations/0009_felt_damage_typology.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf8");
  const columns: string[] = [];
  const addColumnRe = /add column ([a-z_][a-z0-9_]*)\s/g;
  for (const match of sql.matchAll(addColumnRe)) {
    const name = match[1];
    if (name) {
      columns.push(name);
    }
  }
  return columns;
}

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(),
}));

function loadTransport(): typeof import("../supabase-transport") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules, matches queue.test.ts's own discipline
  return require("../supabase-transport");
}

function loadMockedSupabaseLib(): { getSupabaseClient: jest.Mock } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see loadTransport
  return require("@/lib/supabase");
}

const SAMPLE_LOCATION: FeltLocation = { quality: "gps", lat: 35.56, lon: 45.43 };

const SAMPLE_TIER1: Tier1Report = {
  reportId: "11111111-1111-4111-8111-111111111111",
  deviceId: "device-abc",
  // A client-side provider id string with NO registration snapshot attached
  // (e.g. an older queued item, or a defensive edge case) — migration 0011
  // fix under test: this must NOT be sent straight to the uuid `event_id`
  // column; the report degrades to unassigned instead of erroring.
  eventId: "event-xyz",
  eventRegistration: null,
  cartoonLevel: 6,
  location: SAMPLE_LOCATION,
  feltAt: 1_700_000_000_000,
  createdAt: 1_700_000_000_000,
  submittedAt: null,
};

const SAMPLE_EVENT_REGISTRATION: EventRegistration = {
  provider: "usgs",
  providerId: "us1000abcd",
  originTime: 1_699_999_000_000,
  lat: 35.56,
  lon: 45.43,
  depthKm: 10,
  magnitude: 5.4,
  magType: "mww",
  placeName: "32 km SE of Halabja, Iraq",
};

const SAMPLE_TIER1_WITH_EVENT: Tier1Report = {
  ...SAMPLE_TIER1,
  reportId: "33333333-3333-4333-8333-333333333333",
  eventId: "us1000abcd",
  eventRegistration: SAMPLE_EVENT_REGISTRATION,
};

const SAMPLE_TIER2_ANSWERS: Tier2Answers = {
  situation: "inside",
  felt: "yes",
  othersFelt: "most",
  motion: "strong",
  reaction: "somewhat_frightened",
  stand: "no",
  shelf: "few_fell",
  picture: "yes",
  furniture: "no",
  buildingDamageLevel: 1,
  damageTypology: "lowrise",
  roadDamageLevel: 0,
  comment: "Books fell off the shelf.",
};

const SAMPLE_TIER2: Tier2Report = {
  detailId: "22222222-2222-4222-8222-222222222222",
  feltReportId: SAMPLE_TIER1.reportId,
  deviceId: SAMPLE_TIER1.deviceId,
  answers: SAMPLE_TIER2_ANSWERS,
  photoUri: null,
  createdAt: 1_700_000_001_000,
};

const SAMPLE_TIER2_NO_COMMENT: Tier2Report = {
  ...SAMPLE_TIER2,
  answers: { ...SAMPLE_TIER2_ANSWERS, comment: null },
};

beforeEach(() => {
  jest.resetModules();
});

describe("buildFeltReportInsert (pure mapping)", () => {
  it("maps every Tier1Report field to its felt_reports column, using the RESOLVED event id, not report.eventId", () => {
    const { buildFeltReportInsert } = loadTransport();

    // report.eventId is "event-xyz" (a provider-id string) — the resolved
    // uuid passed in as the second argument is what must land in the
    // payload's event_id, proving this function never falls back to the
    // non-uuid string itself (migration 0011 fix under test).
    expect(
      buildFeltReportInsert(SAMPLE_TIER1, "44444444-4444-4444-8444-444444444444"),
    ).toEqual({
      report_id: SAMPLE_TIER1.reportId,
      device_id: "device-abc",
      event_id: "44444444-4444-4444-8444-444444444444",
      cartoon_level: 6,
      lat: 35.56,
      lon: 45.43,
      location_quality: "gps",
      created_at: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it("passes a null event_id through for an unassociated (or unresolved) report", () => {
    const { buildFeltReportInsert } = loadTransport();

    const unassociated: Tier1Report = { ...SAMPLE_TIER1, eventId: null };
    expect(buildFeltReportInsert(unassociated, null).event_id).toBeNull();
  });

  it("every payload key is a real felt_reports column (schema/app sync check)", () => {
    const { buildFeltReportInsert } = loadTransport();
    const columns = loadMigrationColumns("felt_reports");

    for (const key of Object.keys(buildFeltReportInsert(SAMPLE_TIER1, null))) {
      expect(columns).toContain(key);
    }
  });
});

describe("buildFeltReportDetailInsert (pure mapping)", () => {
  it("maps every Tier2Answers field to its felt_report_details column, including raw_answers", () => {
    const { buildFeltReportDetailInsert } = loadTransport();

    expect(buildFeltReportDetailInsert(SAMPLE_TIER2)).toEqual({
      detail_id: SAMPLE_TIER2.detailId,
      felt_report_id: SAMPLE_TIER1.reportId,
      situation: "inside",
      felt_answer: "yes",
      others_felt_answer: "most",
      motion_answer: "strong",
      reaction_answer: "somewhat_frightened",
      stand_answer: "no",
      shelf_answer: "few_fell",
      picture_answer: "yes",
      furniture_answer: "no",
      building_damage_level: 1,
      damage_typology: "lowrise",
      road_damage_level: 0,
      raw_answers: SAMPLE_TIER2_ANSWERS,
    });
  });

  it("every payload key is a real felt_report_details column (schema/app sync check, migration 0003 + 0009)", () => {
    const { buildFeltReportDetailInsert } = loadTransport();
    const columns = [
      ...loadMigrationColumns("felt_report_details"),
      ...loadMigrationColumns0009(),
    ];

    for (const key of Object.keys(buildFeltReportDetailInsert(SAMPLE_TIER2))) {
      expect(columns).toContain(key);
    }
  });

  it("never sends photoUri to felt_report_details — no column exists for it yet (see the build function's own TODO)", () => {
    const { buildFeltReportDetailInsert } = loadTransport();
    const withPhoto: Tier2Report = { ...SAMPLE_TIER2, photoUri: "file:///tmp/photo.jpg" };

    expect(buildFeltReportDetailInsert(withPhoto)).not.toHaveProperty("photo_uri");
    expect(buildFeltReportDetailInsert(withPhoto)).not.toHaveProperty("photoUri");
  });
});

describe("SupabaseTransport.submitTier1", () => {
  function mockClientWithInsertResult(
    error: { code?: string; message?: string } | null,
    rpcResult: { data?: unknown; error?: { message?: string } | null } = { data: null },
  ) {
    const insert = jest.fn(async () => ({ error }));
    const from = jest.fn(() => ({ insert }));
    const rpc = jest.fn(async () => ({ data: rpcResult.data ?? null, error: rpcResult.error ?? null }));
    return { auth: {} as never, from, insert, rpc };
  }

  it("returns 'submitted' on a clean insert, with a null event_id when there is no registration snapshot", async () => {
    const { SupabaseTransport, buildFeltReportInsert } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithInsertResult(null);
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.submitTier1(SAMPLE_TIER1);

    expect(client.from).toHaveBeenCalledWith("felt_reports");
    // No eventRegistration on SAMPLE_TIER1 -> resolveEventUuid is never
    // attempted, and the resolved event id passed into the insert is null
    // (migration 0011 fix: report.eventId, "event-xyz", must NEVER be sent
    // as-is — it isn't a real uuid).
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.insert).toHaveBeenCalledWith(buildFeltReportInsert(SAMPLE_TIER1, null));
    expect(result).toEqual({
      outcome: "submitted",
      serverReportId: SAMPLE_TIER1.reportId,
    });
  });

  it("treats a unique-violation retry as 'submitted', not a failure", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithInsertResult({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.submitTier1(SAMPLE_TIER1);

    expect(result).toEqual({
      outcome: "submitted",
      serverReportId: SAMPLE_TIER1.reportId,
    });
  });

  it("returns a retryable failure for any other insert error", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithInsertResult({ code: "23503", message: "fk violation" });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.submitTier1(SAMPLE_TIER1);

    expect(result).toEqual({ outcome: "failed", retryable: true });
  });

  it("returns 'awaiting-backend' rather than throwing if the client is unexpectedly null", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    supabaseLib.getSupabaseClient.mockReturnValue(null);

    const result = await SupabaseTransport.submitTier1(SAMPLE_TIER1);

    expect(result).toEqual({ outcome: "awaiting-backend" });
  });

  describe("event resolution (migration 0011 upsert_event_from_client RPC)", () => {
    it("resolves eventRegistration via the RPC and inserts the RESOLVED uuid, not the provider id", async () => {
      const { SupabaseTransport, buildFeltReportInsert } = loadTransport();
      const supabaseLib = loadMockedSupabaseLib();
      const resolvedUuid = "55555555-5555-4555-8555-555555555555";
      const client = mockClientWithInsertResult(null, { data: resolvedUuid });
      supabaseLib.getSupabaseClient.mockReturnValue(client);

      const result = await SupabaseTransport.submitTier1(SAMPLE_TIER1_WITH_EVENT);

      expect(client.rpc).toHaveBeenCalledWith("upsert_event_from_client", {
        provider: "usgs",
        provider_event_id: "us1000abcd",
        origin_time: new Date(1_699_999_000_000).toISOString(),
        lat: 35.56,
        lon: 45.43,
        depth_km: 10,
        magnitude: 5.4,
        mag_type: "mww",
        place_name: "32 km SE of Halabja, Iraq",
      });
      expect(client.insert).toHaveBeenCalledWith(
        buildFeltReportInsert(SAMPLE_TIER1_WITH_EVENT, resolvedUuid),
      );
      expect(result.outcome).toBe("submitted");
    });

    it("caches the resolved uuid across submissions for the same (provider, providerId) — only one RPC call", async () => {
      const { SupabaseTransport } = loadTransport();
      const supabaseLib = loadMockedSupabaseLib();
      const resolvedUuid = "55555555-5555-4555-8555-555555555555";
      const client = mockClientWithInsertResult(null, { data: resolvedUuid });
      supabaseLib.getSupabaseClient.mockReturnValue(client);

      await SupabaseTransport.submitTier1(SAMPLE_TIER1_WITH_EVENT);
      await SupabaseTransport.submitTier1({
        ...SAMPLE_TIER1_WITH_EVENT,
        reportId: "66666666-6666-4666-8666-666666666666",
      });

      expect(client.rpc).toHaveBeenCalledTimes(1);
    });

    it("degrades to a null event_id (never fails the report) when the RPC returns an error", async () => {
      const { SupabaseTransport, buildFeltReportInsert } = loadTransport();
      const supabaseLib = loadMockedSupabaseLib();
      const client = mockClientWithInsertResult(null, {
        error: { message: "invalid lat: 999" },
      });
      supabaseLib.getSupabaseClient.mockReturnValue(client);

      const result = await SupabaseTransport.submitTier1(SAMPLE_TIER1_WITH_EVENT);

      expect(client.insert).toHaveBeenCalledWith(
        buildFeltReportInsert(SAMPLE_TIER1_WITH_EVENT, null),
      );
      expect(result.outcome).toBe("submitted");
    });

    it("degrades to a null event_id (never fails the report) when the RPC call throws", async () => {
      const { SupabaseTransport, buildFeltReportInsert } = loadTransport();
      const supabaseLib = loadMockedSupabaseLib();
      const client = mockClientWithInsertResult(null);
      client.rpc = jest.fn(async () => {
        throw new Error("network drop");
      });
      supabaseLib.getSupabaseClient.mockReturnValue(client);

      const result = await SupabaseTransport.submitTier1(SAMPLE_TIER1_WITH_EVENT);

      expect(client.insert).toHaveBeenCalledWith(
        buildFeltReportInsert(SAMPLE_TIER1_WITH_EVENT, null),
      );
      expect(result.outcome).toBe("submitted");
    });
  });
});

describe("buildFeltCommentInsert (pure mapping)", () => {
  it("maps a Tier2Report with a comment to a felt_comments row, keyed by detailId", () => {
    const { buildFeltCommentInsert } = loadTransport();

    expect(buildFeltCommentInsert(SAMPLE_TIER2)).toEqual({
      comment_id: SAMPLE_TIER2.detailId,
      report_id: SAMPLE_TIER1.reportId,
      device_id: "device-abc",
      body: "Books fell off the shelf.",
    });
  });

  it("returns null when there is no comment (the common case — nothing to send)", () => {
    const { buildFeltCommentInsert } = loadTransport();

    expect(buildFeltCommentInsert(SAMPLE_TIER2_NO_COMMENT)).toBeNull();
  });

  it("every payload key is a real felt_comments column (schema/app sync check)", () => {
    const { buildFeltCommentInsert } = loadTransport();
    const columns = loadMigrationColumns("felt_comments");
    const insert = buildFeltCommentInsert(SAMPLE_TIER2);

    expect(insert).not.toBeNull();
    for (const key of Object.keys(insert as object)) {
      expect(columns).toContain(key);
    }
  });
});

describe("SupabaseTransport.submitTier2", () => {
  /** Per-table mock: `felt_report_details` and `felt_comments` need
   * independently controllable results to test the two-insert sequence
   * (2026-08-16 comment-upload-gap fix) — a single shared `insert` mock
   * (the pre-fix version of this test file) can't express "detail insert
   * fails" vs "comment insert fails" as distinct cases. */
  function mockClientWithPerTableResults(
    results: Record<string, { code?: string; message?: string } | null>,
  ) {
    const insertsByTable: Record<string, jest.Mock> = {};
    const from = jest.fn((table: string) => {
      const insert =
        insertsByTable[table] ??
        (insertsByTable[table] = jest.fn(async () => ({
          error: results[table] ?? null,
        })));
      return { insert };
    });
    return { auth: {} as never, from, insertsByTable };
  }

  it("returns 'submitted' on a clean insert into felt_report_details when there is no comment", async () => {
    const { SupabaseTransport, buildFeltReportDetailInsert } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithPerTableResults({});
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.submitTier2(SAMPLE_TIER2_NO_COMMENT);

    expect(client.from).toHaveBeenCalledWith("felt_report_details");
    expect(client.from).not.toHaveBeenCalledWith("felt_comments");
    expect(client.insertsByTable.felt_report_details).toHaveBeenCalledWith(
      buildFeltReportDetailInsert(SAMPLE_TIER2_NO_COMMENT),
    );
    expect(result).toEqual({
      outcome: "submitted",
      serverReportId: SAMPLE_TIER2_NO_COMMENT.detailId,
    });
  });

  it("also inserts into felt_comments when a comment is present (the bug fix)", async () => {
    const { SupabaseTransport, buildFeltCommentInsert } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithPerTableResults({});
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.submitTier2(SAMPLE_TIER2);

    expect(client.from).toHaveBeenCalledWith("felt_comments");
    expect(client.insertsByTable.felt_comments).toHaveBeenCalledWith(
      buildFeltCommentInsert(SAMPLE_TIER2),
    );
    expect(result).toEqual({
      outcome: "submitted",
      serverReportId: SAMPLE_TIER2.detailId,
    });
  });

  it("treats a unique-violation on felt_report_details as 'submitted', not a failure, and still attempts the comment", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithPerTableResults({
      felt_report_details: { code: "23505" },
    });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.submitTier2(SAMPLE_TIER2);

    expect(client.from).toHaveBeenCalledWith("felt_comments");
    expect(result).toEqual({
      outcome: "submitted",
      serverReportId: SAMPLE_TIER2.detailId,
    });
  });

  it("treats a unique-violation on felt_comments as 'submitted' (idempotent retry of an already-sent comment)", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithPerTableResults({
      felt_comments: { code: "23505" },
    });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.submitTier2(SAMPLE_TIER2);

    expect(result).toEqual({
      outcome: "submitted",
      serverReportId: SAMPLE_TIER2.detailId,
    });
  });

  it("returns a retryable failure and skips the comment entirely when felt_report_details fails for another reason", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithPerTableResults({
      felt_report_details: { code: "23503", message: "fk violation" },
    });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.submitTier2(SAMPLE_TIER2);

    expect(client.from).not.toHaveBeenCalledWith("felt_comments");
    expect(result).toEqual({ outcome: "failed", retryable: true });
  });

  it("returns a retryable failure when felt_comments fails for another reason, after felt_report_details already succeeded", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithPerTableResults({
      felt_comments: { code: "23503", message: "fk violation" },
    });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.submitTier2(SAMPLE_TIER2);

    expect(client.insertsByTable.felt_report_details).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ outcome: "failed", retryable: true });
  });

  it("returns 'awaiting-backend' rather than throwing if the client is unexpectedly null", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    supabaseLib.getSupabaseClient.mockReturnValue(null);

    const result = await SupabaseTransport.submitTier2(SAMPLE_TIER2);

    expect(result).toEqual({ outcome: "awaiting-backend" });
  });
});
