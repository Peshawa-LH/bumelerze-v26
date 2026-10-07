import {
  SupabaseHomeTransport,
  parseAssessmentRows,
  parseMemberRows,
  parseTagRows,
  toHomeError,
} from "../transport";
import { HomeError } from "../types";

type Result = {
  data?: unknown;
  error?: { code?: string; message?: string; name?: string; status?: number } | null;
};

interface Recorded {
  table: string;
  calls: [string, unknown[]][];
}

let tableResults: Record<string, Result> = {};
let recorded: Recorded[] = [];
const mockRpc = jest.fn<Promise<Result>, [string, Record<string, unknown>]>();
const mockGetSession = jest.fn();
const mockUpload = jest.fn();
const mockList = jest.fn();
const mockRemove = jest.fn();
const mockSign = jest.fn();
let mockConfigured = true;

function makeBuilder(table: string) {
  const entry: Recorded = { table, calls: [] };
  recorded.push(entry);
  const result = tableResults[table] ?? { data: [], error: null };
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") {
          return (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          entry.calls.push([prop, args]);
          return builder;
        };
      },
    },
  );
  return builder;
}

const mockClient = {
  from: (table: string) => makeBuilder(table),
  rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
  auth: { getSession: () => mockGetSession() },
  storage: {
    from: (bucket: string) => ({
      upload: (path: string, body: unknown, options: unknown) =>
        mockUpload(bucket, path, body, options),
      list: (folder: string, options?: unknown) => mockList(bucket, folder, options),
      remove: (paths: string[]) => mockRemove(bucket, paths),
      createSignedUrls: (paths: string[], ttl: number) => mockSign(bucket, paths, ttl),
    }),
  },
};

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => (mockConfigured ? mockClient : null),
}));

function callsOf(table: string): [string, unknown[]][] {
  return recorded.filter((r) => r.table === table).flatMap((r) => r.calls);
}

beforeEach(() => {
  tableResults = {};
  recorded = [];
  mockConfigured = true;
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: "u1", is_anonymous: false } } },
  });
  mockUpload.mockReset();
  mockUpload.mockResolvedValue({ error: null });
  mockList.mockReset();
  mockRemove.mockReset();
  mockSign.mockReset();
});

describe("toHomeError", () => {
  it("maps the database error codes to short categories", () => {
    expect(toHomeError({ code: "42501" }).code).toBe("need_account");
    expect(toHomeError({ code: "54000" }, "create").code).toBe("homes_limit");
    expect(toHomeError({ code: "54000" }, "join").code).toBe("join_limit");
    expect(toHomeError({ code: "22023" }, "join").code).toBe("wrong_code");
    expect(toHomeError({ message: "Failed to fetch" }).code).toBe("network");
    expect(toHomeError({ name: "AuthRetryableFetchError" }).code).toBe("network");
    expect(toHomeError({ code: "XX000", message: "boom" }).code).toBe("unknown");
    expect(toHomeError("weird").code).toBe("unknown");
  });

  it("passes a HomeError through", () => {
    const original = new HomeError("wrong_code");
    expect(toHomeError(original)).toBe(original);
  });
});

describe("rpc calls match migration 0037", () => {
  it("create_home_tag sends the five parameters and parses the result", async () => {
    mockRpc.mockResolvedValue({
      data: { tag_id: "t1", code: "BMH-7K3Q9P", join_key: "ABCD2345" },
      error: null,
    });
    const created = await SupabaseHomeTransport.createTag({
      kind: "apartment",
      lat: 36.1,
      lon: 44.2,
      label: "Flat",
      unitLabel: "3/7",
    });
    expect(mockRpc).toHaveBeenCalledWith("create_home_tag", {
      p_kind: "apartment",
      p_lat: 36.1,
      p_lon: 44.2,
      p_label: "Flat",
      p_unit_label: "3/7",
    });
    expect(created).toEqual({ tagId: "t1", code: "BMH-7K3Q9P", joinKey: "ABCD2345" });
  });

  it("create_home_tag rejects an anonymous user (42501) and the sixth home (54000)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "create an account first" },
    });
    await expect(
      SupabaseHomeTransport.createTag({
        kind: "house",
        lat: 1,
        lon: 1,
        label: null,
        unitLabel: null,
      }),
    ).rejects.toMatchObject({ code: "need_account" });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "54000", message: "limit" },
    });
    await expect(
      SupabaseHomeTransport.createTag({
        kind: "house",
        lat: 1,
        lon: 1,
        label: null,
        unitLabel: null,
      }),
    ).rejects.toMatchObject({ code: "homes_limit" });
  });

  it("rejects an unexpected create result", async () => {
    mockRpc.mockResolvedValue({ data: { nope: true }, error: null });
    await expect(
      SupabaseHomeTransport.createTag({
        kind: "house",
        lat: 1,
        lon: 1,
        label: null,
        unitLabel: null,
      }),
    ).rejects.toMatchObject({ code: "unknown" });
  });

  it("request_join_home sends code and key and parses the status", async () => {
    mockRpc.mockResolvedValue({ data: { tag_id: "t1", status: "pending" }, error: null });
    await expect(
      SupabaseHomeTransport.requestJoin("BMH-7K3Q9P", "ABCD2345"),
    ).resolves.toEqual({
      tagId: "t1",
      status: "pending",
    });
    expect(mockRpc).toHaveBeenCalledWith("request_join_home", {
      p_code: "BMH-7K3Q9P",
      p_key: "ABCD2345",
    });
  });

  it("request_join_home maps a wrong code (22023) and too many attempts (54000)", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    await expect(
      SupabaseHomeTransport.requestJoin("BMH-AAAAAA", "AAAAAAAA"),
    ).rejects.toMatchObject({
      code: "wrong_code",
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "54000" } });
    await expect(
      SupabaseHomeTransport.requestJoin("BMH-AAAAAA", "AAAAAAAA"),
    ).rejects.toMatchObject({
      code: "join_limit",
    });
  });

  it("decide_join_request, leave_home and rotate_join_key use the migration's parameter names", async () => {
    await SupabaseHomeTransport.decideJoin("t1", "u2", true);
    expect(mockRpc).toHaveBeenCalledWith("decide_join_request", {
      p_tag: "t1",
      p_user: "u2",
      p_approve: true,
    });
    await SupabaseHomeTransport.leave("t1");
    expect(mockRpc).toHaveBeenCalledWith("leave_home", { p_tag: "t1" });
    mockRpc.mockResolvedValueOnce({ data: "NEWKEY99", error: null });
    await expect(SupabaseHomeTransport.rotateKey("t1")).resolves.toBe("NEWKEY99");
    expect(mockRpc).toHaveBeenCalledWith("rotate_join_key", { p_tag: "t1" });
  });

  it("owners-only errors (42501) surface as need_account", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(
      SupabaseHomeTransport.decideJoin("t1", "u2", false),
    ).rejects.toMatchObject({
      code: "need_account",
    });
  });

  it("rotate_join_key rejects a non-string result", async () => {
    mockRpc.mockResolvedValue({ data: { nope: 1 }, error: null });
    await expect(SupabaseHomeTransport.rotateKey("t1")).rejects.toMatchObject({
      code: "unknown",
    });
  });
});

describe("table reads", () => {
  it("reads the caller's memberships", async () => {
    tableResults.home_members = {
      data: [
        {
          tag_id: "t1",
          user_id: "u1",
          role: "owner",
          status: "approved",
          requested_at: "x",
        },
        {
          tag_id: "t2",
          user_id: "u1",
          role: "member",
          status: "pending",
          requested_at: "x",
        },
        { bad: "row" },
      ],
    };
    const members = await SupabaseHomeTransport.fetchMemberships("u1");
    expect(members).toHaveLength(2);
    expect(callsOf("home_members")).toContainEqual(["eq", ["user_id", "u1"]]);
  });

  it("reads tags by id and skips the call for an empty list", async () => {
    await expect(SupabaseHomeTransport.fetchTags([])).resolves.toEqual([]);
    expect(recorded).toHaveLength(0);
    tableResults.home_tags = {
      data: [
        {
          tag_id: "t1",
          code: "BMH-7K3Q9P",
          owner_user_id: "u1",
          kind: "house",
          label: null,
          unit_label: null,
          lat: 36.1,
          lon: 44.2,
          complex_id: null,
          status: "active",
          created_at: "x",
        },
      ],
    };
    const tags = await SupabaseHomeTransport.fetchTags(["t1"]);
    expect(tags[0]?.code).toBe("BMH-7K3Q9P");
    expect(callsOf("home_tags")).toContainEqual(["in", ["tag_id", ["t1"]]]);
  });

  it("reads the join key from home_tag_secrets (owner only)", async () => {
    tableResults.home_tag_secrets = { data: { join_key: "ABCD2345" } };
    await expect(SupabaseHomeTransport.fetchJoinKey("t1")).resolves.toBe("ABCD2345");
    tableResults.home_tag_secrets = { data: null };
    await expect(SupabaseHomeTransport.fetchJoinKey("t1")).resolves.toBeNull();
  });

  it("reads members of a tag oldest first and display names from profiles", async () => {
    tableResults.home_members = {
      data: [
        {
          tag_id: "t1",
          user_id: "u1",
          role: "owner",
          status: "approved",
          requested_at: "x",
        },
      ],
    };
    await SupabaseHomeTransport.fetchMembers("t1");
    expect(callsOf("home_members")).toContainEqual(["eq", ["tag_id", "t1"]]);
    tableResults.profiles = { data: [{ user_id: "u1", display_name: "Shilan" }] };
    await expect(SupabaseHomeTransport.fetchDisplayNames(["u1"])).resolves.toEqual({
      u1: "Shilan",
    });
  });

  it("keeps only the newest assessment per tag", async () => {
    const row = (id: string, tag: string, vc: string) => ({
      assessment_id: id,
      tag_id: tag,
      survey_id: null,
      method: "auto-v0",
      ims_type_probs: { M6: 1 },
      vc_probs: { C: 1 },
      vc_most_likely: vc,
      vc_range: "C",
      confidence: "0.5",
      hazard: { pga_g: 0.3, zone: "III", vs30: 400, site_class: "B", source: "ISC-2025" },
      review_status: "automatic",
      created_at: "x",
    });
    tableResults.home_assessments = {
      data: [row("new", "t1", "B"), row("old", "t1", "C"), row("o2", "t2", "D")],
    };
    const latest = await SupabaseHomeTransport.fetchLatestAssessments(["t1", "t2"]);
    expect(latest.t1?.assessmentId).toBe("new");
    expect(latest.t1?.confidence).toBe(0.5);
    expect(latest.t2?.vcMostLikely).toBe("D");
    expect(callsOf("home_assessments")).toContainEqual([
      "order",
      ["created_at", { ascending: false }],
    ]);
  });

  it("reads the latest survey", async () => {
    tableResults.home_surveys = {
      data: [
        {
          survey_id: "s1",
          tag_id: "t1",
          version: "q-v0",
          answers: { floors: "f2" },
          created_at: "x",
        },
      ],
    };
    await expect(SupabaseHomeTransport.fetchLatestSurvey("t1")).resolves.toMatchObject({
      surveyId: "s1",
      answers: { floors: "f2" },
    });
    tableResults.home_surveys = { data: [] };
    await expect(SupabaseHomeTransport.fetchLatestSurvey("t1")).resolves.toBeNull();
  });
});

describe("table writes", () => {
  it("inserts a survey with the signed-in user and returns its id", async () => {
    tableResults.home_surveys = { data: { survey_id: "s1" } };
    const id = await SupabaseHomeTransport.saveSurvey({
      tagId: "t1",
      version: "q-v0",
      answers: { floors: "f2" },
    });
    expect(id).toBe("s1");
    expect(callsOf("home_surveys")).toContainEqual([
      "insert",
      [{ tag_id: "t1", user_id: "u1", version: "q-v0", answers: { floors: "f2" } }],
    ]);
  });

  it("refuses to save a survey without an account", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "a1", is_anonymous: true } } },
    });
    await expect(
      SupabaseHomeTransport.saveSurvey({ tagId: "t1", version: "q-v0", answers: {} }),
    ).rejects.toMatchObject({ code: "need_account" });
  });

  it("inserts an automatic assessment with every column of 0037", async () => {
    await SupabaseHomeTransport.saveAssessment({
      tagId: "t1",
      surveyId: "s1",
      assessment: {
        method: "auto-v0",
        ims_type_probs: { M6: 1 },
        vc_probs: { A: 0, B: 0.25, C: 0.625, D: 0.125, E: 0, F: 0 },
        vc_most_likely: "C",
        vc_range: "B-C",
        confidence: 0.75,
        hazard: {
          pga_g: 0.3,
          zone: "III",
          vs30: 400,
          site_class: "B",
          source: "ISC-2025",
        },
      },
    });
    expect(callsOf("home_assessments")).toContainEqual([
      "insert",
      [
        {
          tag_id: "t1",
          survey_id: "s1",
          method: "auto-v0",
          ims_type_probs: { M6: 1 },
          vc_probs: { A: 0, B: 0.25, C: 0.625, D: 0.125, E: 0, F: 0 },
          vc_most_likely: "C",
          vc_range: "B-C",
          confidence: 0.75,
          hazard: {
            pga_g: 0.3,
            zone: "III",
            vs30: 400,
            site_class: "B",
            source: "ISC-2025",
          },
          review_status: "automatic",
        },
      ],
    ]);
  });
});

describe("photos", () => {
  it("uploads to the private home-photos bucket under <tag_id>/<file>", async () => {
    const body = new ArrayBuffer(8);
    await SupabaseHomeTransport.uploadPhoto({
      tagId: "t1",
      fileName: "1700000000000.jpg",
      body,
      contentType: "image/jpeg",
    });
    expect(mockUpload).toHaveBeenCalledWith("home-photos", "t1/1700000000000.jpg", body, {
      contentType: "image/jpeg",
      upsert: false,
    });
  });

  it("a retry whose first upload already landed is not an error", async () => {
    mockUpload.mockResolvedValue({ error: { message: "The resource already exists" } });
    await expect(
      SupabaseHomeTransport.uploadPhoto({
        tagId: "t1",
        fileName: "front-1.jpg",
        body: new ArrayBuffer(1),
        contentType: "image/jpeg",
      }),
    ).resolves.toBeUndefined();
  });

  it("records the slot and caption in home_photos, one row per file", async () => {
    await SupabaseHomeTransport.savePhotoMeta({
      tagId: "t1",
      fileName: "more-17.jpg",
      slot: "more",
      caption: "  crack by the door ",
    });
    const calls = callsOf("home_photos");
    expect(calls[0]?.[0]).toBe("upsert");
    expect(calls[0]?.[1][0]).toEqual({
      tag_id: "t1",
      path: "t1/more-17.jpg",
      slot: "more",
      caption: "crack by the door",
      user_id: "u1",
    });
    expect(calls[0]?.[1][1]).toEqual({ onConflict: "path", ignoreDuplicates: true });
  });

  it("stores an empty caption as null", async () => {
    await SupabaseHomeTransport.savePhotoMeta({
      tagId: "t1",
      fileName: "front-1.jpg",
      slot: "front",
      caption: " ",
    });
    expect(
      (callsOf("home_photos")[0]?.[1][0] as { caption: unknown }).caption,
    ).toBeNull();
  });

  it("lists photos with signed urls, slots and captions; suggested slots first", async () => {
    mockList.mockResolvedValue({
      data: [
        { name: "more-2.jpg" },
        { name: ".emptyFolderPlaceholder" },
        { name: "roof-3.jpg" },
        { name: "front-1.jpg" },
      ],
      error: null,
    });
    mockSign.mockResolvedValue({
      data: [
        { path: "t1/more-2.jpg", signedUrl: "https://signed/more" },
        { path: "t1/roof-3.jpg", signedUrl: "https://signed/roof" },
        { path: "t1/front-1.jpg", signedUrl: "https://signed/front" },
      ],
      error: null,
    });
    tableResults.home_photos = {
      data: [{ path: "t1/more-2.jpg", slot: "more", caption: "cracks" }],
      error: null,
    };
    const photos = await SupabaseHomeTransport.fetchPhotos("t1");
    expect(photos.map((photo) => [photo.slot, photo.caption, photo.url])).toEqual([
      ["front", null, "https://signed/front"],
      ["roof", null, "https://signed/roof"],
      ["more", "cracks", "https://signed/more"],
    ]);
    expect(mockSign).toHaveBeenCalledWith(
      "home-photos",
      ["t1/more-2.jpg", "t1/roof-3.jpg", "t1/front-1.jpg"],
      3600,
    );
  });

  it("still lists the photos when the caption table does not exist yet", async () => {
    mockList.mockResolvedValue({
      data: [{ name: "back-1.jpg" }, { name: "7.jpg" }],
      error: null,
    });
    mockSign.mockResolvedValue({
      data: [
        { path: "t1/back-1.jpg", signedUrl: "https://signed/back" },
        { path: "t1/7.jpg", signedUrl: "https://signed/old" },
      ],
      error: null,
    });
    tableResults.home_photos = {
      data: null,
      error: { code: "42P01", message: "no table" },
    };
    const photos = await SupabaseHomeTransport.fetchPhotos("t1");
    // slot from the file name; a q-v1 file (<time>.jpg) is an extra without a caption
    expect(photos.map((photo) => [photo.slot, photo.caption])).toEqual([
      ["back", null],
      ["more", null],
    ]);
  });

  it("returns nothing for a home without photos", async () => {
    mockList.mockResolvedValue({ data: [], error: null });
    await expect(SupabaseHomeTransport.fetchPhotos("t1")).resolves.toEqual([]);
    expect(mockSign).not.toHaveBeenCalled();
  });
});

describe("deleteHome", () => {
  const files = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `f${i}.jpg` }));

  it("removes the photo files, then calls delete_home_tag (migration 0049)", async () => {
    const order: string[] = [];
    mockList.mockImplementation(async () => ({ data: files(2), error: null }));
    mockRemove.mockImplementation(async (_bucket: string, paths: string[]) => {
      order.push("remove");
      return { data: paths.map((name) => ({ name })), error: null };
    });
    mockRpc.mockImplementation(async () => {
      order.push("rpc");
      return { data: null, error: null };
    });
    await expect(SupabaseHomeTransport.deleteHome("t1")).resolves.toEqual({
      photosLeftBehind: false,
    });
    expect(order).toEqual(["remove", "rpc"]);
    expect(mockList).toHaveBeenCalledWith("home-photos", "t1", {
      limit: 100,
      offset: 0,
    });
    expect(mockRemove).toHaveBeenCalledWith("home-photos", ["t1/f0.jpg", "t1/f1.jpg"]);
    expect(mockRpc).toHaveBeenCalledWith("delete_home_tag", { p_tag: "t1" });
  });

  it("removes in batches of 50", async () => {
    mockList
      .mockResolvedValueOnce({ data: files(100), error: null })
      .mockResolvedValueOnce({ data: files(20), error: null });
    mockRemove.mockImplementation(async (_bucket: string, paths: string[]) => ({
      data: paths.map((name) => ({ name })),
      error: null,
    }));
    await SupabaseHomeTransport.deleteHome("t1");
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockRemove.mock.calls.map((call) => (call[1] as string[]).length)).toEqual([
      50, 50, 20,
    ]);
  });

  it("skips storage calls for a home with no files", async () => {
    mockList.mockResolvedValue({ data: [], error: null });
    await SupabaseHomeTransport.deleteHome("t1");
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith("delete_home_tag", { p_tag: "t1" });
  });

  it("retries a failed removal once and succeeds", async () => {
    mockList.mockResolvedValue({ data: files(1), error: null });
    mockRemove
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockResolvedValueOnce({ data: [{ name: "t1/f0.jpg" }], error: null });
    await expect(SupabaseHomeTransport.deleteHome("t1")).resolves.toEqual({
      photosLeftBehind: false,
    });
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });

  it("still deletes the home when removal keeps failing, and says files are left", async () => {
    mockList.mockResolvedValue({ data: files(2), error: null });
    mockRemove.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(SupabaseHomeTransport.deleteHome("t1")).resolves.toEqual({
      photosLeftBehind: true,
    });
    expect(mockRemove).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith("delete_home_tag", { p_tag: "t1" });
  });

  it("reports files left when storage removes only some of a batch", async () => {
    mockList.mockResolvedValue({ data: files(3), error: null });
    mockRemove.mockResolvedValue({ data: [{ name: "t1/f0.jpg" }], error: null });
    await expect(SupabaseHomeTransport.deleteHome("t1")).resolves.toEqual({
      photosLeftBehind: true,
    });
  });

  it("a listing failure that is not the network does not block the delete", async () => {
    mockList.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(SupabaseHomeTransport.deleteHome("t1")).resolves.toEqual({
      photosLeftBehind: true,
    });
    expect(mockRpc).toHaveBeenCalledWith("delete_home_tag", { p_tag: "t1" });
  });

  it("a network failure while listing throws and deletes nothing", async () => {
    mockList.mockResolvedValue({
      data: null,
      error: { message: "Failed to fetch", name: "StorageUnknownError" },
    });
    await expect(SupabaseHomeTransport.deleteHome("t1")).rejects.toMatchObject({
      code: "network",
    });
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("maps a refused delete (not the owner) to a HomeError", async () => {
    mockList.mockResolvedValue({ data: [], error: null });
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "delete_home_tag: owners only" },
    });
    await expect(SupabaseHomeTransport.deleteHome("t1")).rejects.toMatchObject({
      code: "need_account",
    });
  });

  it("needs a configured project", async () => {
    mockConfigured = false;
    await expect(SupabaseHomeTransport.deleteHome("t1")).rejects.toMatchObject({
      code: "unconfigured",
    });
  });
});

describe("configuration and parsing", () => {
  it("throws 'unconfigured' without a Supabase client", async () => {
    mockConfigured = false;
    await expect(SupabaseHomeTransport.leave("t1")).rejects.toMatchObject({
      code: "unconfigured",
    });
  });

  it("drops rows that do not match the contract", () => {
    expect(parseTagRows("nope")).toEqual([]);
    expect(parseMemberRows([{ tag_id: 1 }])).toEqual([]);
    expect(parseAssessmentRows([{ vc_most_likely: "Z" }])).toEqual([]);
  });

  it("fills missing VC classes with zero and a missing hazard with null", () => {
    const [row] = parseAssessmentRows([
      {
        assessment_id: "a",
        tag_id: "t",
        survey_id: null,
        method: "auto-v0",
        ims_type_probs: { M6: 1 },
        vc_probs: { C: 1 },
        vc_most_likely: "C",
        vc_range: null,
        confidence: null,
        hazard: null,
        review_status: "automatic",
        created_at: "x",
      },
    ]);
    expect(row?.vcProbs).toEqual({ A: 0, B: 0, C: 1, D: 0, E: 0, F: 0 });
    expect(row?.hazard).toBeNull();
    expect(row?.confidence).toBeNull();
  });
});
