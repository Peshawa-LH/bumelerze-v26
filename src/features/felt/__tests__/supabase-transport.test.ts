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

// `signInAnonymously` defaults to a no-op success — `ensureAnonymousUserId`
// (supabase-transport.ts) then reads the resulting session via
// `client.auth.getSession()`, which every mock client below defaults to
// "no session" (see `mockAuth()`), so the DEFAULT behavior across this
// whole file is "anonymous sign-in succeeded but there's still no session
// to read a uid from" -> `user_id: null` — matching every pre-existing
// assertion in this file that computes its expected payload via
// `buildFeltReportInsert(..., null)`/`buildFeltCommentInsert(...)` (no
// third/second argument). Tests that need a REAL uid override
// `client.auth.getSession` per-test; tests that need sign-in to fail
// override `signInAnonymously` per-test.
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(),
  signInAnonymously: jest.fn(() => Promise.resolve()),
}));

function loadTransport(): typeof import("../supabase-transport") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules, matches queue.test.ts's own discipline
  return require("../supabase-transport");
}

function loadMockedSupabaseLib(): {
  getSupabaseClient: jest.Mock;
  signInAnonymously: jest.Mock;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see loadTransport
  return require("@/lib/supabase");
}

type MockSession = { user: { id: string } } | null;

/** Shared "no anonymous session" auth mock — every mock client in this file
 * uses this by default (see the `jest.mock` comment above); tests that need
 * a real uid replace `getSession` with a resolved-session mock instead. */
function mockAuth() {
  return {
    getSession: jest.fn(
      async (): Promise<{ data: { session: MockSession }; error: null }> => ({
        data: { session: null },
        error: null,
      }),
    ),
  };
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
      user_id: null,
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

  it("populates user_id from the third argument, defaulting to null when omitted", () => {
    const { buildFeltReportInsert } = loadTransport();

    expect(buildFeltReportInsert(SAMPLE_TIER1, null).user_id).toBeNull();
    expect(
      buildFeltReportInsert(SAMPLE_TIER1, null, "77777777-7777-4777-8777-777777777777")
        .user_id,
    ).toBe("77777777-7777-4777-8777-777777777777");
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
    return { auth: mockAuth(), from, insert, rpc };
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

      // p_-prefixed names — must match migration 0011's PL/pgSQL parameter
      // names exactly (PostgREST resolves rpc args by name; the unprefixed
      // form fails live — regression-locked here).
      expect(client.rpc).toHaveBeenCalledWith("upsert_event_from_client", {
        p_provider: "usgs",
        p_provider_event_id: "us1000abcd",
        p_origin_time: new Date(1_699_999_000_000).toISOString(),
        p_lat: 35.56,
        p_lon: 45.43,
        p_depth_km: 10,
        p_magnitude: 5.4,
        p_mag_type: "mww",
        p_place_name: "32 km SE of Halabja, Iraq",
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

  describe("anonymous-session wiring (2026-08-16 storage wave)", () => {
    it("calls signInAnonymously() before inserting", async () => {
      const { SupabaseTransport } = loadTransport();
      const supabaseLib = loadMockedSupabaseLib();
      const client = mockClientWithInsertResult(null);
      supabaseLib.getSupabaseClient.mockReturnValue(client);

      await SupabaseTransport.submitTier1(SAMPLE_TIER1);

      expect(supabaseLib.signInAnonymously).toHaveBeenCalled();
      // Order matters: sign-in must resolve before the insert is attempted,
      // so a resulting session's uid can be read into the payload.
      const signInOrder = supabaseLib.signInAnonymously.mock.invocationCallOrder[0];
      const insertOrder = client.insert.mock.invocationCallOrder[0];
      expect(signInOrder).toBeDefined();
      expect(insertOrder).toBeDefined();
      expect(signInOrder as number).toBeLessThan(insertOrder as number);
    });

    it("populates user_id from the session's uid once an anonymous session exists", async () => {
      const { SupabaseTransport, buildFeltReportInsert } = loadTransport();
      const supabaseLib = loadMockedSupabaseLib();
      const client = mockClientWithInsertResult(null);
      client.auth.getSession = jest.fn(async () => ({
        data: { session: { user: { id: "anon-uid-1" } } },
        error: null,
      }));
      supabaseLib.getSupabaseClient.mockReturnValue(client);

      await SupabaseTransport.submitTier1(SAMPLE_TIER1);

      expect(client.insert).toHaveBeenCalledWith(
        buildFeltReportInsert(SAMPLE_TIER1, null, "anon-uid-1"),
      );
    });

    it("still submits the report, with user_id null, when signInAnonymously rejects", async () => {
      const { SupabaseTransport, buildFeltReportInsert } = loadTransport();
      const supabaseLib = loadMockedSupabaseLib();
      const client = mockClientWithInsertResult(null);
      supabaseLib.getSupabaseClient.mockReturnValue(client);
      supabaseLib.signInAnonymously.mockRejectedValueOnce(new Error("no network"));

      const result = await SupabaseTransport.submitTier1(SAMPLE_TIER1);

      expect(client.insert).toHaveBeenCalledWith(buildFeltReportInsert(SAMPLE_TIER1, null, null));
      expect(result).toEqual({ outcome: "submitted", serverReportId: SAMPLE_TIER1.reportId });
    });

    it("still submits the report, with user_id null, when a session exists but carries no session object", async () => {
      const { SupabaseTransport, buildFeltReportInsert } = loadTransport();
      const supabaseLib = loadMockedSupabaseLib();
      const client = mockClientWithInsertResult(null);
      client.auth.getSession = jest.fn(async () => ({
        data: { session: null },
        error: null,
      }));
      supabaseLib.getSupabaseClient.mockReturnValue(client);

      const result = await SupabaseTransport.submitTier1(SAMPLE_TIER1);

      expect(client.insert).toHaveBeenCalledWith(buildFeltReportInsert(SAMPLE_TIER1, null, null));
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
      user_id: null,
      body: "Books fell off the shelf.",
    });
  });

  it("populates user_id from the second argument, defaulting to null when omitted", () => {
    const { buildFeltCommentInsert } = loadTransport();

    expect(buildFeltCommentInsert(SAMPLE_TIER2)?.user_id).toBeNull();
    expect(
      buildFeltCommentInsert(SAMPLE_TIER2, "77777777-7777-4777-8777-777777777777")?.user_id,
    ).toBe("77777777-7777-4777-8777-777777777777");
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
    return { auth: mockAuth(), from, insertsByTable };
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

describe("SupabaseTransport.uploadPhoto (2026-08-16 storage wave)", () => {
  const SAMPLE_TIER2_WITH_PHOTO: Tier2Report = {
    ...SAMPLE_TIER2,
    photoUri: "file:///tmp/damage.jpg",
  };

  /** `readPhotoBody` branches on `Platform.OS === "web"` — this mock covers
   * the NATIVE (`expo-file-system` `File.arrayBuffer()`) branch, which is
   * what runs under jest-expo's default (non-"web") `Platform.OS`. The web
   * branch (`fetch(uri).blob()`) gets its own test below with `Platform.OS`
   * temporarily flipped, matching `sensor-screen-web.test.tsx`'s own
   * pattern for testing both platform branches in one file. */
  const mockArrayBuffer = jest.fn(async () => new ArrayBuffer(8));
  jest.mock("expo-file-system", () => ({
    File: jest.fn().mockImplementation(() => ({ arrayBuffer: mockArrayBuffer })),
  }));

  function mockStorageClient(options: {
    session?: { user: { id: string } } | null;
    uploadError?: { message: string } | null;
    upsertError?: { message: string } | null;
  }) {
    const upload = jest.fn(async () => ({ error: options.uploadError ?? null }));
    const storageFrom = jest.fn(() => ({ upload }));
    const upsert = jest.fn(async () => ({ error: options.upsertError ?? null }));
    const from = jest.fn(() => ({ upsert }));
    const getSession = jest.fn(async () => ({
      data: { session: options.session === undefined ? { user: { id: "anon-uid-1" } } : options.session },
      error: null,
    }));
    return { auth: { getSession }, storage: { from: storageFrom }, from, upload, storageFrom, upsert };
  }

  it("returns 'uploaded' immediately (no-op) when the report has no photo", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockStorageClient({});
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.uploadPhoto?.(SAMPLE_TIER2);

    expect(result).toEqual({ outcome: "uploaded" });
    expect(client.storageFrom).not.toHaveBeenCalled();
  });

  it("uploads to <auth.uid()>/<felt_report_id>.jpg and upserts the felt_photos row on the happy path", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockStorageClient({});
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.uploadPhoto?.(SAMPLE_TIER2_WITH_PHOTO);

    expect(client.storageFrom).toHaveBeenCalledWith("felt-photos");
    expect(client.upload).toHaveBeenCalledWith(
      `anon-uid-1/${SAMPLE_TIER2_WITH_PHOTO.feltReportId}.jpg`,
      expect.anything(),
      expect.objectContaining({ upsert: true, contentType: "image/jpeg" }),
    );
    expect(client.from).toHaveBeenCalledWith("felt_photos");
    expect(client.upsert).toHaveBeenCalledWith(
      {
        report_id: SAMPLE_TIER2_WITH_PHOTO.feltReportId,
        storage_path: `anon-uid-1/${SAMPLE_TIER2_WITH_PHOTO.feltReportId}.jpg`,
      },
      { onConflict: "report_id" },
    );
    expect(result).toEqual({ outcome: "uploaded" });
  });

  it("defers (fails, retryable) rather than uploading when there is no anonymous session — no safe path to write to", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockStorageClient({ session: null });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.uploadPhoto?.(SAMPLE_TIER2_WITH_PHOTO);

    expect(client.storageFrom).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "failed" });
  });

  it("returns 'failed' when the storage upload itself errors, without attempting the felt_photos upsert", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockStorageClient({ uploadError: { message: "bucket not found" } });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.uploadPhoto?.(SAMPLE_TIER2_WITH_PHOTO);

    expect(client.from).not.toHaveBeenCalledWith("felt_photos");
    expect(result).toEqual({ outcome: "failed" });
  });

  it("returns 'failed' when the storage upload succeeds but the felt_photos upsert errors", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockStorageClient({ upsertError: { message: "constraint violation" } });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseTransport.uploadPhoto?.(SAMPLE_TIER2_WITH_PHOTO);

    expect(client.upload).toHaveBeenCalled();
    expect(result).toEqual({ outcome: "failed" });
  });

  it("returns 'failed' rather than throwing if the client is unexpectedly null", async () => {
    const { SupabaseTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    supabaseLib.getSupabaseClient.mockReturnValue(null);

    const result = await SupabaseTransport.uploadPhoto?.(SAMPLE_TIER2_WITH_PHOTO);

    expect(result).toEqual({ outcome: "failed" });
  });

  it("uploads via fetch(uri).blob() on web (Platform.OS === 'web')", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- scoped require, matches sensor-screen-web.test.tsx's own Platform.OS override pattern
    const { Platform } = require("react-native") as typeof import("react-native");
    const originalPlatformOS = Platform.OS;
    Platform.OS = "web";
    const originalFetch = global.fetch;
    const mockBlob = { size: 8, type: "image/jpeg" };
    global.fetch = jest.fn(async () => ({ blob: async () => mockBlob })) as unknown as typeof fetch;

    try {
      const { SupabaseTransport } = loadTransport();
      const supabaseLib = loadMockedSupabaseLib();
      const client = mockStorageClient({});
      supabaseLib.getSupabaseClient.mockReturnValue(client);

      const result = await SupabaseTransport.uploadPhoto?.(SAMPLE_TIER2_WITH_PHOTO);

      expect(global.fetch).toHaveBeenCalledWith(SAMPLE_TIER2_WITH_PHOTO.photoUri);
      expect(client.upload).toHaveBeenCalledWith(
        `anon-uid-1/${SAMPLE_TIER2_WITH_PHOTO.feltReportId}.jpg`,
        mockBlob,
        expect.objectContaining({ upsert: true }),
      );
      expect(result).toEqual({ outcome: "uploaded" });
    } finally {
      Platform.OS = originalPlatformOS;
      global.fetch = originalFetch;
    }
  });
});
