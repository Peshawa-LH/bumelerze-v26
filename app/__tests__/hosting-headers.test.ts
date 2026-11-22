import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * public/_headers (security audit APP-07 / LIVE-06, A2.3). Cloudflare Pages
 * applies every rule whose path matches; `! Name` drops a header an earlier
 * rule set. These checks keep the policy from loosening by accident and keep
 * the CAPTCHA page's script hash in step with the page.
 */
const ROOT = join(__dirname, "..", "..");
const raw = readFileSync(join(ROOT, "public", "_headers"), "utf8");

type Rule = { path: string; set: Map<string, string>; drop: string[] };

function parse(text: string): Rule[] {
  const rules: Rule[] = [];
  let current: Rule | null = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }
    if (!/^\s/.test(line)) {
      current = { path: line.trim(), set: new Map(), drop: [] };
      rules.push(current);
      continue;
    }
    if (!current) {
      throw new Error(`header line outside a rule: ${line}`);
    }
    const body = line.trim();
    if (body.startsWith("!")) {
      current.drop.push(body.slice(1).trim().toLowerCase());
    } else {
      const colon = body.indexOf(":");
      current.set.set(body.slice(0, colon).trim().toLowerCase(), body.slice(colon + 1).trim());
    }
  }
  return rules;
}

const rules = parse(raw);
const rule = (path: string) => {
  const found = rules.find((r) => r.path === path);
  if (!found) {
    throw new Error(`no rule for ${path}`);
  }
  return found;
};
const directives = (csp: string) =>
  new Map(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name as string, values] as const;
      }),
  );

describe("the page policy (/*)", () => {
  const page = rule("/*");
  const csp = directives(page.set.get("content-security-policy") ?? "");

  it("is enforced, not report-only", () => {
    expect(page.set.has("content-security-policy")).toBe(true);
    expect(page.set.has("content-security-policy-report-only")).toBe(false);
  });

  it("runs scripts from this origin and Turnstile only, never eval or inline", () => {
    expect(csp.get("script-src")).toEqual(["'self'", "https://challenges.cloudflare.com"]);
    expect(page.set.get("content-security-policy")).not.toContain("unsafe-eval");
    expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
  });

  it("connects only to the services the app uses, over TLS", () => {
    const connect = csp.get("connect-src") ?? [];
    expect(connect[0]).toBe("'self'");
    for (const origin of connect.slice(1)) {
      expect(origin).toMatch(/^(https|wss):\/\/[a-z0-9.-]+$/);
    }
    for (const needed of [
      "https://bcgyxepgruwardhozvfq.supabase.co",
      "wss://bcgyxepgruwardhozvfq.supabase.co",
      "https://earthquake.usgs.gov",
      "https://www.seismicportal.eu",
      "https://geofon.gfz.de",
      "https://tiles.openfreemap.org",
      "https://api.maptiler.com",
      "https://peshawa-lh.github.io",
      "wss://rtserve.earthscope.org",
    ]) {
      expect(connect).toContain(needed);
    }
  });

  it("keeps the other hardening headers", () => {
    expect(page.set.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(page.set.get("x-frame-options")).toBe("DENY");
    expect(page.set.get("x-content-type-options")).toBe("nosniff");
    expect(page.set.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(page.set.get("permissions-policy")).toContain("microphone=()");
    expect(page.set.get("permissions-policy")).toContain("geolocation=(self)");
  });

  it("does not cache the app's scripts for long yet (B2.5: missing files answer the app page)", () => {
    expect(raw).not.toMatch(/immutable/);
  });
});

describe("the map worker's own policy", () => {
  const worker = rule("/maplibre-gl-worker.mjs");

  it("replaces the page policy and allows eval inside the worker only (RTL text plugin)", () => {
    expect(worker.drop).toContain("content-security-policy");
    const csp = directives(worker.set.get("content-security-policy") ?? "");
    expect(csp.get("script-src")).toEqual(["'self'", "'unsafe-eval'"]);
    expect(csp.get("default-src")).toEqual(["'none'"]);
    expect(csp.get("connect-src")).toEqual(
      expect.arrayContaining(["https://tiles.openfreemap.org", "https://peshawa-lh.github.io"]),
    );
  });
});

describe("the CAPTCHA page for the phone apps (/turnstile)", () => {
  const html = readFileSync(join(ROOT, "public", "turnstile.html"), "utf8");
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] as string);
  const hash = `'sha256-${createHash("sha256").update(inline[0] ?? "").digest("base64")}'`;

  it("has exactly one inline script, and both rules allow exactly its hash", () => {
    expect(inline).toHaveLength(1);
    for (const path of ["/turnstile", "/turnstile.html"]) {
      const r = rule(path);
      expect(r.drop).toContain("content-security-policy");
      const csp = directives(r.set.get("content-security-policy") ?? "");
      expect(csp.get("script-src")).toEqual([hash, "https://challenges.cloudflare.com"]);
      expect(csp.get("frame-src")).toEqual(["https://challenges.cloudflare.com"]);
    }
  });
});
