/**
 * The shared secret check (function-secret.ts, migration 0074): a missing or
 * wrong header is 401 with a fixed body, an unreadable secret is 503 and is
 * not cached, the right one passes, the value is loaded once per instance
 * (reloaded on a mismatch at most once a minute, for rotation), and the four
 * functions run the check before anything else.
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  createFunctionSecretCheck,
  FUNCTION_SECRET_HEADER,
  MIN_SECRET_LENGTH,
  RELOAD_AFTER_MS,
  rpcSecretLoader,
  sameSecret,
  UNAUTHORIZED,
  UNAVAILABLE,
} from "../function-secret";

const SECRET = "a".repeat(32) + "0123456789abcdef0123456789abcdef";
const ROTATED = "b".repeat(64);

function headers(values: Record<string, string> = {}) {
  const lower = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}
const withSecret = (value: string) => headers({ [FUNCTION_SECRET_HEADER]: value });

function setup(values: unknown[] = [SECRET]) {
  let t = 1_000_000;
  const load = jest.fn(async () => {
    const next = values.length > 1 ? values.shift() : values[0];
    if (next instanceof Error) throw next;
    return next;
  });
  const onLoadError = jest.fn();
  const check = createFunctionSecretCheck(load, { now: () => t, onLoadError });
  return {
    check,
    load,
    onLoadError,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("sameSecret", () => {
  it("is true only for the same string", () => {
    expect(sameSecret(SECRET, SECRET)).toBe(true);
    expect(sameSecret(SECRET.slice(0, -1) + "0", SECRET)).toBe(false);
    expect(sameSecret("0" + SECRET.slice(1), SECRET)).toBe(false);
    expect(sameSecret(SECRET.slice(0, 63), SECRET)).toBe(false);
    expect(sameSecret(SECRET + "0", SECRET)).toBe(false);
    expect(sameSecret("", SECRET)).toBe(false);
    expect(sameSecret(SECRET, "")).toBe(false);
  });

  it("does not stop at the first difference (always walks the whole expected value)", () => {
    const reads: number[] = [];
    const spy = jest.spyOn(String.prototype, "charCodeAt").mockImplementation(function (
      this: string,
      i: number,
    ) {
      reads.push(i);
      return this.length > i ? (this.codePointAt(i) ?? NaN) : NaN;
    });
    try {
      sameSecret("z" + SECRET.slice(1), SECRET);
    } finally {
      spy.mockRestore();
    }
    // every index of the expected value was read, although index 0 differs
    expect(new Set(reads).size).toBe(SECRET.length);
  });
});

describe("the check", () => {
  it("passes the right secret", async () => {
    const { check } = setup();
    await expect(check(withSecret(SECRET))).resolves.toBeNull();
  });

  it("refuses a missing header with 401 and a fixed body, without loading the secret", async () => {
    const { check, load } = setup();
    await expect(check(headers())).resolves.toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
    await expect(check(withSecret(""))).resolves.toBe(UNAUTHORIZED);
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret with the same 401", async () => {
    const { check } = setup();
    for (const wrong of [
      SECRET.toUpperCase(),
      SECRET.slice(1),
      `${SECRET} `,
      "sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I",
    ]) {
      await expect(check(withSecret(wrong))).resolves.toEqual(UNAUTHORIZED);
    }
  });

  it("reads the header case-insensitively, as HTTP does", async () => {
    const { check } = setup();
    await expect(
      check(headers({ "X-Bumelerze-Function-Secret": SECRET })),
    ).resolves.toBeNull();
  });

  it("never puts the secret or the given value in a refusal", async () => {
    const { check } = setup();
    const text = JSON.stringify(
      await check(withSecret("guess-guess-guess-guess-guess-guess")),
    );
    expect(text).toBe(JSON.stringify(UNAUTHORIZED));
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("guess");
  });

  it("loads the secret once per instance and reuses it", async () => {
    const { check, load } = setup();
    await check(withSecret(SECRET));
    await check(withSecret(SECRET));
    await check(withSecret("x".repeat(64)));
    await check(headers());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one load between concurrent first calls", async () => {
    const { check, load } = setup();
    const answers = await Promise.all([
      check(withSecret(SECRET)),
      check(withSecret(SECRET)),
      check(withSecret(SECRET)),
    ]);
    expect(answers).toEqual([null, null, null]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("when the secret cannot be read", () => {
  it("fails closed with 503, does not cache the failure and asks again next time", async () => {
    const { check, load, onLoadError } = setup([
      new Error("permission denied for function edge_function_secret"),
      SECRET,
    ]);
    await expect(check(withSecret(SECRET))).resolves.toEqual({
      status: 503,
      body: { error: "unavailable" },
    });
    expect(onLoadError).toHaveBeenCalledWith(
      expect.stringContaining("could not be read"),
    );
    await expect(check(withSecret(SECRET))).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["null (no secret in Vault)", null],
    ["empty", ""],
    ["too short", "a".repeat(MIN_SECRET_LENGTH - 1)],
    ["not a string", { secret: SECRET }],
  ])("refuses an expected value that is %s with 503", async (_label, value) => {
    const { check, onLoadError } = setup([value]);
    await expect(check(withSecret(SECRET))).resolves.toBe(UNAVAILABLE);
    await expect(check(withSecret(""))).resolves.toBe(UNAUTHORIZED);
    expect(onLoadError).toHaveBeenCalledWith(
      "edge_function_secret is missing or too short",
    );
  });

  it("never logs the secret", async () => {
    const { check, onLoadError } = setup([new Error(`boom ${"y".repeat(500)}`)]);
    await check(withSecret(SECRET));
    const logged = onLoadError.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain(SECRET);
    expect(logged.length).toBeLessThan(300);
  });
});

describe("rotation", () => {
  it("a mismatch reloads a copy older than a minute, and the new value passes", async () => {
    const { check, load, advance } = setup([SECRET, ROTATED]);
    await expect(check(withSecret(SECRET))).resolves.toBeNull();
    // within the minute: a wrong value does not reload
    await expect(check(withSecret(ROTATED))).resolves.toBe(UNAUTHORIZED);
    expect(load).toHaveBeenCalledTimes(1);
    advance(RELOAD_AFTER_MS);
    await expect(check(withSecret(ROTATED))).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    // the old value is now refused, and the reload clock restarted
    await expect(check(withSecret(SECRET))).resolves.toBe(UNAUTHORIZED);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("wrong guesses reload at most once a minute", async () => {
    const { check, load, advance } = setup();
    await check(withSecret(SECRET));
    for (let i = 0; i < 10; i += 1) {
      advance(RELOAD_AFTER_MS / 5);
      await check(withSecret(`wrong-${i}`.padEnd(64, "0")));
    }
    // 10 guesses over two minutes: two reloads
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("a failed reload is 503; the copy it had still serves the jobs", async () => {
    const { check, load, advance } = setup([SECRET, new Error("network"), SECRET]);
    await check(withSecret(SECRET));
    advance(RELOAD_AFTER_MS);
    await expect(check(withSecret(ROTATED))).resolves.toBe(UNAVAILABLE);
    await expect(check(withSecret(SECRET))).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("rpcSecretLoader", () => {
  it("calls rpc edge_function_secret and returns its data", async () => {
    const rpc = jest.fn(async () => ({ data: SECRET, error: null }));
    await expect(rpcSecretLoader(() => ({ rpc }))()).resolves.toBe(SECRET);
    expect(rpc).toHaveBeenCalledWith("edge_function_secret");
  });

  it("throws the rpc error, which the check turns into 503", async () => {
    const rpc = jest.fn(async () => ({
      data: null,
      error: { message: "permission denied" },
    }));
    const loader = rpcSecretLoader(() => ({ rpc }));
    await expect(loader()).rejects.toThrow("permission denied");
    const check = createFunctionSecretCheck(loader);
    await expect(check(withSecret(SECRET))).resolves.toBe(UNAVAILABLE);
  });

  it("a client that cannot be made (missing environment) is 503 too", async () => {
    const check = createFunctionSecretCheck(
      rpcSecretLoader(() => {
        throw new Error("missing SUPABASE_URL");
      }),
    );
    await expect(check(withSecret(SECRET))).resolves.toBe(UNAVAILABLE);
  });
});

describe("the wiring", () => {
  const FUNCTIONS = [
    "aggregate-felt-cells",
    "ingest-events",
    "purge-home-photos",
    "send-alerts",
  ];
  const source = (fn: string) =>
    readFileSync(join(__dirname, "../..", fn, "index.ts"), "utf8");

  it.each(FUNCTIONS)(
    "%s checks the secret first, before the method or the body",
    (fn) => {
      const code = source(fn);
      expect(code).toContain('from "../_shared/function-secret.ts";');
      const serve = code.slice(code.indexOf("Deno.serve(async (req: Request) => {"));
      expect(serve.length).toBeGreaterThan(0);
      const lines = serve.split("\n").map((l) => l.trim());
      expect(lines[1]).toBe("const refused = await checkSecret(req.headers);");
      expect(lines[2]).toBe("if (refused) return refusalResponse(refused);");
      expect(code.indexOf("req.text()")).toBeGreaterThan(
        code.indexOf("await checkSecret(req.headers)"),
      );
      expect(
        [...code.matchAll(/req\.(text|json|method|body)\b/g)].every(
          (m) => (m.index ?? 0) > code.indexOf("await checkSecret(req.headers)"),
        ),
      ).toBe(true);
      expect(code).toMatch(/const checkSecret = createFunctionSecretCheck\(/);
    },
  );

  it("matches migration 0074: the header name and the rpc", () => {
    const sql = readFileSync(
      join(__dirname, "../../../migrations/0074_function_secret.sql"),
      "utf8",
    );
    expect(sql).toContain(`'${FUNCTION_SECRET_HEADER}', v_secret`);
    expect(sql).toContain(
      "grant execute on function public.edge_function_secret() to service_role;",
    );
    expect(readFileSync(join(__dirname, "../function-secret.ts"), "utf8")).toContain(
      'rpc("edge_function_secret")',
    );
  });
});
