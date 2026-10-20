/**
 * Review-safe builds (`EXPO_PUBLIC_REVIEW_READONLY=1`): the Supabase client
 * may read but never write or sign in, and a refusal looks like being
 * offline. No real network anywhere: the "network" is a jest mock behind
 * the wrapper, and the end-to-end cases drive a REAL supabase-js client
 * (not the mocked one `supabase.test.ts` uses) so the methods and paths
 * checked are the ones supabase-js actually sends.
 */
import { createClient } from "@supabase/supabase-js";

import {
  createReviewReadonlyFetch,
  isAllowedInReviewReadonly,
  isReviewReadonlyBuild,
  REVIEW_READONLY_REFUSAL_MESSAGE,
} from "../review-readonly";

// Mutate the flag on the SAME `process.env` object (never replace the
// object): the transformed module keeps a reference to it from import time.
const ORIGINAL_FLAG = process.env.EXPO_PUBLIC_REVIEW_READONLY;
const SUPABASE_URL = "https://example.supabase.co";

function okResponse(body: unknown = []): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeBaseFetch(): jest.Mock<Promise<Response>, Parameters<typeof fetch>> {
  return jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => okResponse());
}

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.EXPO_PUBLIC_REVIEW_READONLY;
  } else {
    process.env.EXPO_PUBLIC_REVIEW_READONLY = ORIGINAL_FLAG;
  }
});

describe("isReviewReadonlyBuild", () => {
  it("is off by default", () => {
    delete process.env.EXPO_PUBLIC_REVIEW_READONLY;
    expect(isReviewReadonlyBuild()).toBe(false);
  });

  it("is on only for exactly '1'", () => {
    process.env.EXPO_PUBLIC_REVIEW_READONLY = "1";
    expect(isReviewReadonlyBuild()).toBe(true);
    for (const value of ["0", "", "true", "yes"]) {
      process.env.EXPO_PUBLIC_REVIEW_READONLY = value;
      expect(isReviewReadonlyBuild()).toBe(false);
    }
  });
});

describe("isAllowedInReviewReadonly", () => {
  const table = `${SUPABASE_URL}/rest/v1/events?select=*`;

  it("lets reads through (GET by default, explicit GET and HEAD)", () => {
    expect(isAllowedInReviewReadonly(table)).toBe(true);
    expect(isAllowedInReviewReadonly(table, { method: "get" })).toBe(true);
    expect(isAllowedInReviewReadonly(table, { method: "HEAD" })).toBe(true);
  });

  it("refuses every write method", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "post"]) {
      expect(isAllowedInReviewReadonly(table, { method })).toBe(false);
    }
  });

  it("refuses every auth call, reads included", () => {
    expect(isAllowedInReviewReadonly(`${SUPABASE_URL}/auth/v1/user`)).toBe(false);
    expect(
      isAllowedInReviewReadonly(`${SUPABASE_URL}/auth/v1/signup`, { method: "POST" }),
    ).toBe(false);
  });

  it("reads the method and URL off a Request object too", () => {
    const post = new Request(table, { method: "POST" });
    const get = new Request(table);
    expect(isAllowedInReviewReadonly(post)).toBe(false);
    expect(isAllowedInReviewReadonly(get)).toBe(true);
    expect(isAllowedInReviewReadonly(new URL(`${SUPABASE_URL}/auth/v1/user`))).toBe(
      false,
    );
  });
});

describe("createReviewReadonlyFetch", () => {
  it("passes reads to the real fetch unchanged", async () => {
    const base = makeBaseFetch();
    const guarded = createReviewReadonlyFetch(base);
    const init = { method: "GET", headers: { apikey: "k" } };

    await guarded(`${SUPABASE_URL}/rest/v1/events`, init);

    expect(base).toHaveBeenCalledWith(`${SUPABASE_URL}/rest/v1/events`, init);
  });

  it("rejects a write with React Native's offline error and never reaches the network", async () => {
    const base = makeBaseFetch();
    const guarded = createReviewReadonlyFetch(base);

    const attempt = guarded(`${SUPABASE_URL}/rest/v1/felt_reports`, { method: "POST" });

    await expect(attempt).rejects.toThrow(TypeError);
    await expect(attempt).rejects.toThrow(REVIEW_READONLY_REFUSAL_MESSAGE);
    expect(base).not.toHaveBeenCalled();
  });

  it("returns a rejected promise instead of throwing synchronously", () => {
    const guarded = createReviewReadonlyFetch(makeBaseFetch());
    let returned: Promise<Response> | undefined;
    expect(() => {
      returned = guarded(`${SUPABASE_URL}/rest/v1/rpc/check_in`, { method: "POST" });
    }).not.toThrow();
    return expect(returned).rejects.toThrow(REVIEW_READONLY_REFUSAL_MESSAGE);
  });
});

describe("a real supabase-js client behind the read-only fetch", () => {
  function makeClient(base: jest.Mock) {
    return createClient(SUPABASE_URL, "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: createReviewReadonlyFetch(base) },
    });
  }

  it("still reads a table", async () => {
    const base = makeBaseFetch();
    const client = makeClient(base);

    const { error } = await client.from("events").select("*").limit(1);

    expect(error).toBeNull();
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("refuses an insert, an update, a delete and an RPC as an offline error (status 0)", async () => {
    const base = makeBaseFetch();
    const client = makeClient(base);

    const results = await Promise.all([
      client.from("felt_reports").insert({ id: "x" }),
      client.from("profiles").update({ about: "x" }).eq("id", "x"),
      client.from("home_tags").delete().eq("id", "x"),
      client.rpc("check_in", { p_status: "safe" }),
    ]);

    for (const { error, status } of results) {
      expect(status).toBe(0);
      expect(error?.message).toMatch(/network request failed/i);
    }
    expect(base).not.toHaveBeenCalled();
  });

  it("refuses an anonymous sign-in without creating an account", async () => {
    const base = makeBaseFetch();
    const client = makeClient(base);

    const { data, error } = await client.auth.signInAnonymously();

    expect(data.session).toBeNull();
    expect(error).not.toBeNull();
    expect(base).not.toHaveBeenCalled();
  });

  it("refuses a photo upload to storage", async () => {
    const base = makeBaseFetch();
    const client = makeClient(base);

    const { error } = await client.storage
      .from("felt-photos")
      .upload("a/b.jpg", new Blob(["x"]), { contentType: "image/jpeg" });

    expect(error).not.toBeNull();
    expect(base).not.toHaveBeenCalled();
  });
});
