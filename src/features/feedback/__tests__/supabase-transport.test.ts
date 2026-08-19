import * as fs from "node:fs";
import * as path from "node:path";

import type { FeedbackContext, FeedbackPhotoAttachment, FeedbackSubmission } from "../types";

/**
 * `SupabaseFeedbackTransport` — no real network call anywhere in this file,
 * mirroring `src/features/felt/__tests__/supabase-transport.test.ts`'s own
 * discipline exactly (mock `@/lib/supabase` at the seam; parse
 * `supabase/migrations/0020_feedback.sql` (table creation) AND
 * `supabase/migrations/0022_feedback_triage.sql` (the `screen` column
 * drop) with a small regex extractor so the client-side payload mapping
 * and the DB schema — as it stands TODAY, not just at 0020 — can never
 * silently drift apart).
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

/** Columns a later migration dropped from `tableName` — parsed straight out
 * of `ALTER TABLE ... DROP COLUMN [IF EXISTS] <col>;` statements, same
 * "read the real SQL, don't hand-maintain a parallel list" discipline as
 * `extractTableColumns` itself. */
function extractDroppedColumns(sql: string, tableName: string): string[] {
  const pattern = new RegExp(
    `alter table public\\.${tableName}\\s+drop column(?: if exists)? (\\w+)`,
    "gi",
  );
  const dropped: string[] = [];
  for (const match of sql.matchAll(pattern)) {
    if (match[1]) {
      dropped.push(match[1]);
    }
  }
  return dropped;
}

function readMigration(fileName: string): string {
  const sqlPath = path.join(__dirname, "../../../../supabase/migrations", fileName);
  return fs.readFileSync(sqlPath, "utf8");
}

/** The columns `tableName` actually has TODAY — 0020's `CREATE TABLE`
 * columns, minus anything a later migration (currently just 0022) dropped.
 * Any future migration that drops or adds columns on this table should
 * extend this function rather than have callers reach for a single
 * migration file directly. */
function loadMigrationColumns(tableName: string): string[] {
  const created = extractTableColumns(readMigration("0020_feedback.sql"), tableName);
  const dropped = extractDroppedColumns(readMigration("0022_feedback_triage.sql"), tableName);
  return created.filter((column) => !dropped.includes(column));
}

// `signInAnonymously` defaults to a no-op success — `ensureAnonymousUserId`
// then reads the resulting session via `client.auth.getSession()`, which
// every mock client below defaults to "no session" (see `mockAuth()`), same
// convention as `src/features/felt/__tests__/supabase-transport.test.ts`.
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(),
  signInAnonymously: jest.fn(() => Promise.resolve()),
}));

function loadTransport(): typeof import("../supabase-transport") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
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

const SAMPLE_CONTEXT: FeedbackContext = {
  appVersion: "0.1.0",
  locale: "en",
  platform: "android",
};

const SAMPLE_SUBMISSION: FeedbackSubmission = {
  feedbackId: "11111111-1111-4111-8111-111111111111",
  deviceId: "device-abc",
  message: "The map crashed when I tapped a cluster.",
  contact: "tester@example.com",
  context: SAMPLE_CONTEXT,
  photos: [],
  createdAt: 1_700_000_000_000,
};

const SAMPLE_PHOTO: FeedbackPhotoAttachment = {
  photoId: "33333333-3333-4333-8333-333333333333",
  uri: "file:///tmp/screenshot.jpg",
};

const SAMPLE_SUBMISSION_WITH_PHOTO: FeedbackSubmission = {
  ...SAMPLE_SUBMISSION,
  feedbackId: "22222222-2222-4222-8222-222222222222",
  photos: [SAMPLE_PHOTO],
};

beforeEach(() => {
  jest.resetModules();
});

describe("buildFeedbackInsert (pure mapping)", () => {
  it("maps every FeedbackSubmission field to its feedback column", () => {
    const { buildFeedbackInsert } = loadTransport();

    expect(buildFeedbackInsert(SAMPLE_SUBMISSION)).toEqual({
      feedback_id: SAMPLE_SUBMISSION.feedbackId,
      device_id: "device-abc",
      user_id: null,
      message: "The map crashed when I tapped a cluster.",
      contact: "tester@example.com",
      app_version: "0.1.0",
      locale: "en",
      platform: "android",
      created_at: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it("populates user_id from the second argument, defaulting to null when omitted", () => {
    const { buildFeedbackInsert } = loadTransport();

    expect(buildFeedbackInsert(SAMPLE_SUBMISSION).user_id).toBeNull();
    expect(
      buildFeedbackInsert(SAMPLE_SUBMISSION, "77777777-7777-4777-8777-777777777777").user_id,
    ).toBe("77777777-7777-4777-8777-777777777777");
  });

  it("passes null contact/context fields straight through (never invents a value)", () => {
    const { buildFeedbackInsert } = loadTransport();
    const noContext: FeedbackSubmission = {
      ...SAMPLE_SUBMISSION,
      contact: null,
      context: { appVersion: null, locale: null, platform: null },
    };

    expect(buildFeedbackInsert(noContext)).toMatchObject({
      contact: null,
      app_version: null,
      locale: null,
      platform: null,
    });
  });

  it("never sends screen (migration 0022 dropped the column; owner: never wanted)", () => {
    const { buildFeedbackInsert } = loadTransport();

    expect(buildFeedbackInsert(SAMPLE_SUBMISSION)).not.toHaveProperty("screen");
  });

  it("never sends a triage field — status/category/triage_note/updated_at are owner-assigned only, server-side (migration 0022)", () => {
    const { buildFeedbackInsert } = loadTransport();

    const payload = buildFeedbackInsert(SAMPLE_SUBMISSION);
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("category");
    expect(payload).not.toHaveProperty("triage_note");
    expect(payload).not.toHaveProperty("updated_at");
  });

  it("every payload key is a real, still-current feedback column (schema/app sync check, migrations 0020 + 0022)", () => {
    const { buildFeedbackInsert } = loadTransport();
    const columns = loadMigrationColumns("feedback");

    for (const key of Object.keys(buildFeedbackInsert(SAMPLE_SUBMISSION))) {
      expect(columns).toContain(key);
    }
  });
});

describe("buildFeedbackPhotoInsert (pure mapping)", () => {
  it("maps a photo id + resolved storage path to a feedback_photos row (migration 0021: keyed by photo_id, not feedback_id)", () => {
    const { buildFeedbackPhotoInsert } = loadTransport();

    expect(buildFeedbackPhotoInsert("photo-1", "feedback-1", "uid/feedback-1/photo-1.jpg")).toEqual({
      photo_id: "photo-1",
      feedback_id: "feedback-1",
      storage_path: "uid/feedback-1/photo-1.jpg",
    });
  });

  it("every payload key is a real feedback_photos column (schema/app sync check, migration 0020 — 0021 adds no columns)", () => {
    const { buildFeedbackPhotoInsert } = loadTransport();
    const columns = loadMigrationColumns("feedback_photos");

    for (const key of Object.keys(
      buildFeedbackPhotoInsert("photo-1", "feedback-1", "uid/feedback-1/photo-1.jpg"),
    )) {
      expect(columns).toContain(key);
    }
  });
});

describe("SupabaseFeedbackTransport.submit", () => {
  function mockClientWithInsertResult(error: { code?: string; message?: string } | null) {
    const insert = jest.fn(async () => ({ error }));
    const from = jest.fn(() => ({ insert }));
    return { auth: mockAuth(), from, insert };
  }

  it("returns 'submitted' on a clean insert", async () => {
    const { SupabaseFeedbackTransport, buildFeedbackInsert } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithInsertResult(null);
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseFeedbackTransport.submit(SAMPLE_SUBMISSION);

    expect(client.from).toHaveBeenCalledWith("feedback");
    expect(client.insert).toHaveBeenCalledWith(buildFeedbackInsert(SAMPLE_SUBMISSION));
    expect(result).toEqual({
      outcome: "submitted",
      serverFeedbackId: SAMPLE_SUBMISSION.feedbackId,
    });
  });

  it("treats a unique-violation retry as 'submitted', not a failure (the runaway-client guard, migration 0020)", async () => {
    const { SupabaseFeedbackTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithInsertResult({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseFeedbackTransport.submit(SAMPLE_SUBMISSION);

    expect(result).toEqual({
      outcome: "submitted",
      serverFeedbackId: SAMPLE_SUBMISSION.feedbackId,
    });
  });

  it("returns a retryable failure for any other insert error", async () => {
    const { SupabaseFeedbackTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithInsertResult({ code: "23514", message: "check violation" });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseFeedbackTransport.submit(SAMPLE_SUBMISSION);

    expect(result).toEqual({ outcome: "failed", retryable: true });
  });

  it("returns 'awaiting-backend' rather than throwing if the client is unexpectedly null", async () => {
    const { SupabaseFeedbackTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    supabaseLib.getSupabaseClient.mockReturnValue(null);

    const result = await SupabaseFeedbackTransport.submit(SAMPLE_SUBMISSION);

    expect(result).toEqual({ outcome: "awaiting-backend" });
  });

  it("calls signInAnonymously() before inserting and populates user_id from the resulting session", async () => {
    const { SupabaseFeedbackTransport, buildFeedbackInsert } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithInsertResult(null);
    client.auth.getSession = jest.fn(async () => ({
      data: { session: { user: { id: "anon-uid-1" } } },
      error: null,
    }));
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    await SupabaseFeedbackTransport.submit(SAMPLE_SUBMISSION);

    expect(supabaseLib.signInAnonymously).toHaveBeenCalled();
    expect(client.insert).toHaveBeenCalledWith(
      buildFeedbackInsert(SAMPLE_SUBMISSION, "anon-uid-1"),
    );
  });

  it("still submits, with user_id null, when signInAnonymously rejects", async () => {
    const { SupabaseFeedbackTransport, buildFeedbackInsert } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockClientWithInsertResult(null);
    supabaseLib.getSupabaseClient.mockReturnValue(client);
    supabaseLib.signInAnonymously.mockRejectedValueOnce(new Error("no network"));

    const result = await SupabaseFeedbackTransport.submit(SAMPLE_SUBMISSION);

    expect(client.insert).toHaveBeenCalledWith(buildFeedbackInsert(SAMPLE_SUBMISSION, null));
    expect(result).toEqual({
      outcome: "submitted",
      serverFeedbackId: SAMPLE_SUBMISSION.feedbackId,
    });
  });
});

describe("SupabaseFeedbackTransport.uploadPhoto", () => {
  const mockArrayBuffer = jest.fn(async () => new ArrayBuffer(8));
  jest.mock("expo-file-system", () => ({
    File: jest.fn().mockImplementation(() => ({ arrayBuffer: mockArrayBuffer })),
  }));

  function mockStorageClient(options: {
    session?: { user: { id: string } } | null;
    uploadError?: { message: string } | null;
    upsertError?: { message: string } | null;
  }) {
    const upload = jest.fn(async (_path: string, ..._rest: unknown[]) => ({
      error: options.uploadError ?? null,
    }));
    const storageFrom = jest.fn(() => ({ upload }));
    const upsert = jest.fn(async () => ({ error: options.upsertError ?? null }));
    const from = jest.fn(() => ({ upsert }));
    const getSession = jest.fn(async () => ({
      data: {
        session: options.session === undefined ? { user: { id: "anon-uid-1" } } : options.session,
      },
      error: null,
    }));
    return { auth: { getSession }, storage: { from: storageFrom }, from, upload, storageFrom, upsert };
  }

  // The pre-0021 "no-op when there is no photo" case no longer applies at
  // this layer: `photo` is now a required argument (one call per photo, see
  // `queue.ts`'s per-photo upload pass), not read off `submission.photoUri`
  // internally. That intent (never attempt an upload when nothing was
  // picked) still lives on, one layer up, as queue.test.ts's "never
  // attempts a photo upload when there are no photoUris".

  it("uploads to <auth.uid()>/<feedback_id>/<photo_id>.jpg and upserts the feedback_photos row keyed on photo_id (migration 0021)", async () => {
    const { SupabaseFeedbackTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockStorageClient({});
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseFeedbackTransport.uploadPhoto?.(
      SAMPLE_SUBMISSION_WITH_PHOTO,
      SAMPLE_PHOTO,
    );

    expect(client.storageFrom).toHaveBeenCalledWith("feedback-photos");
    expect(client.upload).toHaveBeenCalledWith(
      `anon-uid-1/${SAMPLE_SUBMISSION_WITH_PHOTO.feedbackId}/${SAMPLE_PHOTO.photoId}.jpg`,
      expect.anything(),
      expect.objectContaining({ upsert: true, contentType: "image/jpeg" }),
    );
    expect(client.from).toHaveBeenCalledWith("feedback_photos");
    expect(client.upsert).toHaveBeenCalledWith(
      {
        photo_id: SAMPLE_PHOTO.photoId,
        feedback_id: SAMPLE_SUBMISSION_WITH_PHOTO.feedbackId,
        storage_path: `anon-uid-1/${SAMPLE_SUBMISSION_WITH_PHOTO.feedbackId}/${SAMPLE_PHOTO.photoId}.jpg`,
      },
      { onConflict: "photo_id" },
    );
    expect(result).toEqual({ outcome: "uploaded" });
  });

  it("uploads two photos on the same submission to two DISTINCT, non-colliding storage paths", async () => {
    const { SupabaseFeedbackTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockStorageClient({});
    supabaseLib.getSupabaseClient.mockReturnValue(client);
    const secondPhoto: FeedbackPhotoAttachment = {
      photoId: "44444444-4444-4444-8444-444444444444",
      uri: "file:///tmp/second.jpg",
    };

    await SupabaseFeedbackTransport.uploadPhoto?.(SAMPLE_SUBMISSION_WITH_PHOTO, SAMPLE_PHOTO);
    await SupabaseFeedbackTransport.uploadPhoto?.(SAMPLE_SUBMISSION_WITH_PHOTO, secondPhoto);

    const uploadedPaths = client.upload.mock.calls.map((call) => call[0]);
    expect(new Set(uploadedPaths).size).toBe(2);
    expect(uploadedPaths).toEqual([
      `anon-uid-1/${SAMPLE_SUBMISSION_WITH_PHOTO.feedbackId}/${SAMPLE_PHOTO.photoId}.jpg`,
      `anon-uid-1/${SAMPLE_SUBMISSION_WITH_PHOTO.feedbackId}/${secondPhoto.photoId}.jpg`,
    ]);
  });

  it("defers (fails, retryable) rather than uploading when there is no anonymous session", async () => {
    const { SupabaseFeedbackTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockStorageClient({ session: null });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseFeedbackTransport.uploadPhoto?.(
      SAMPLE_SUBMISSION_WITH_PHOTO,
      SAMPLE_PHOTO,
    );

    expect(client.storageFrom).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "failed" });
  });

  it("returns 'failed' when the storage upload itself errors, without attempting the feedback_photos upsert", async () => {
    const { SupabaseFeedbackTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockStorageClient({ uploadError: { message: "bucket not found" } });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseFeedbackTransport.uploadPhoto?.(
      SAMPLE_SUBMISSION_WITH_PHOTO,
      SAMPLE_PHOTO,
    );

    expect(client.from).not.toHaveBeenCalledWith("feedback_photos");
    expect(result).toEqual({ outcome: "failed" });
  });

  it("returns 'failed' when the storage upload succeeds but the feedback_photos upsert errors", async () => {
    const { SupabaseFeedbackTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    const client = mockStorageClient({ upsertError: { message: "constraint violation" } });
    supabaseLib.getSupabaseClient.mockReturnValue(client);

    const result = await SupabaseFeedbackTransport.uploadPhoto?.(
      SAMPLE_SUBMISSION_WITH_PHOTO,
      SAMPLE_PHOTO,
    );

    expect(client.upload).toHaveBeenCalled();
    expect(result).toEqual({ outcome: "failed" });
  });

  it("returns 'failed' rather than throwing if the client is unexpectedly null", async () => {
    const { SupabaseFeedbackTransport } = loadTransport();
    const supabaseLib = loadMockedSupabaseLib();
    supabaseLib.getSupabaseClient.mockReturnValue(null);

    const result = await SupabaseFeedbackTransport.uploadPhoto?.(
      SAMPLE_SUBMISSION_WITH_PHOTO,
      SAMPLE_PHOTO,
    );

    expect(result).toEqual({ outcome: "failed" });
  });
});
