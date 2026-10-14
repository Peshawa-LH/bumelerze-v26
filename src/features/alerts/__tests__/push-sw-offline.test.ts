/**
 * The offline copy in public/push-sw.js (the app's one service worker), run
 * in a sandbox with fake caches and a fake network: network first for page
 * loads with the cached page only when the network is unreachable, cache
 * first only for real content-hashed files, nothing cross-origin or POST,
 * one cache per deploy, the previous deploy kept until this one is complete,
 * and the emergency switch.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { runInNewContext } from "vm";

const RAW = readFileSync(join(__dirname, "../../../../public/push-sw.js"), "utf8");
const ORIGIN = "https://app.bumelerze.com";
const SCOPE = `${ORIGIN}/`;

function stamp(build: string, mode = "on"): string {
  const out = RAW.replace(
    /^var BUILD_ID = "dev";$/m,
    `var BUILD_ID = "${build}";`,
  ).replace(/^var OFFLINE_MODE = "on";$/m, `var OFFLINE_MODE = "${mode}";`);
  if (build !== "dev") {
    expect(out).toContain(`var BUILD_ID = "${build}";`);
  }
  return out;
}

const keyOf = (input: unknown) =>
  typeof input === "string" ? input : (input as { url: string }).url;

class FakeCaches {
  stores = new Map<string, Map<string, Response>>();
  open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    const store = this.stores.get(name)!;
    return Promise.resolve({
      match: (req: unknown) => Promise.resolve(store.get(keyOf(req))?.clone()),
      put: (req: unknown, res: Response) => {
        store.set(keyOf(req), res.clone());
        return Promise.resolve();
      },
    });
  }
  match(req: unknown) {
    for (const store of this.stores.values()) {
      const hit = store.get(keyOf(req));
      if (hit) return Promise.resolve(hit.clone());
    }
    return Promise.resolve(undefined);
  }
  keys() {
    return Promise.resolve([...this.stores.keys()]);
  }
  delete(name: string) {
    return Promise.resolve(this.stores.delete(name));
  }
  urls(name: string) {
    return [...(this.stores.get(name)?.keys() ?? [])].sort();
  }
}

const page = (build: string, extra = "") =>
  `<!DOCTYPE html><html><head><meta name="bumelerze-build" content="${build}"><link rel="stylesheet" href="/_expo/static/css/app-1.css"></head><body><div id="root"></div><script src="/_expo/static/js/web/entry-${build}.js" defer></script>${extra}</body></html>`;

const html = (body: string) =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const js = (body = "x") =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "application/javascript" },
  });

type Net = (url: string) => Promise<Response>;

function load(build: string, net: Net, mode = "on", fakeCaches = new FakeCaches()) {
  const listeners: Record<string, (event: Record<string, unknown>) => void> = {};
  const fetches: string[] = [];
  const self = {
    registration: { scope: SCOPE, showNotification: jest.fn() },
    location: { origin: ORIGIN },
    skipWaiting: jest.fn(),
    clients: {
      claim: jest.fn(() => Promise.resolve()),
      matchAll: jest.fn(),
      openWindow: jest.fn(),
    },
    addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => {
      listeners[type] = fn;
    },
  };
  const fetch = (input: unknown) => {
    const url = keyOf(input);
    fetches.push(url);
    return net(url);
  };
  runInNewContext(stamp(build, mode), {
    self,
    caches: fakeCaches,
    fetch,
    Request,
    Response,
    URL,
    Date,
    Promise,
    Number,
    String,
  });
  /** Runs an event like the browser: collects respondWith and waits for all waitUntil work. */
  const fire = async (type: string, event: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    listeners[type]?.({
      ...event,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
    });
    const response = responded ? await responded.catch((e: unknown) => e) : undefined;
    // waitUntil work can add more waitUntil work: settle until quiet.
    for (let i = 0; i < 5; i += 1) {
      await Promise.all(waits.splice(0));
      await new Promise((r) => setTimeout(r, 0));
    }
    return response;
  };
  return { fire, caches: fakeCaches, fetches, self };
}

const nav = (path: string) => ({
  request: { url: `${ORIGIN}${path}`, method: "GET", mode: "navigate" },
});
const get = (url: string) => ({ request: { url, method: "GET", mode: "no-cors" } });

function onlineNet(build: string): Net {
  return (url) => {
    if (url === SCOPE || url.startsWith(`${ORIGIN}/event`))
      return Promise.resolve(html(page(build)));
    if (url.endsWith(".css")) {
      return Promise.resolve(
        new Response("a{}", { status: 200, headers: { "content-type": "text/css" } }),
      );
    }
    if (url.includes("/_expo/static/js/") && url.includes(build))
      return Promise.resolve(js(url));
    // Like Cloudflare Pages: a missing file answers with the app page.
    return Promise.resolve(html(page(build)));
  };
}
const offlineNet: Net = () => Promise.reject(new TypeError("Failed to fetch"));

describe("push-sw.js offline copy", () => {
  it("does nothing when not stamped by the build (development)", async () => {
    const sw = load("dev", onlineNet("dev"));
    await sw.fire("install");
    expect(await sw.fire("fetch", nav("/"))).toBeUndefined();
    expect(sw.caches.stores.size).toBe(0);
  });

  it("installs: keeps this deploy's page and the files it names", async () => {
    const sw = load("b1", onlineNet("b1"));
    await sw.fire("install");
    expect(sw.self.skipWaiting).toHaveBeenCalled();
    expect(sw.caches.urls("bumelerze-app-b1")).toEqual([
      `${ORIGIN}/__offline-shell`,
      `${ORIGIN}/_expo/static/css/app-1.css`,
      `${ORIGIN}/_expo/static/js/web/entry-b1.js`,
    ]);
  });

  it("page loads: network first, the saved page only when the network is unreachable", async () => {
    let online = true;
    const sw = load("b1", (url) => (online ? onlineNet("b1")(url) : offlineNet(url)));
    await sw.fire("install");
    const fresh = (await sw.fire("fetch", nav("/event/bml2026abcd"))) as Response;
    expect(await fresh.text()).toContain("entry-b1.js");
    expect(sw.fetches).toContain(`${ORIGIN}/event/bml2026abcd`);

    online = false;
    const saved = (await sw.fire("fetch", nav("/event/bml2026abcd"))) as Response;
    expect(saved.headers.get("content-type")).toContain("text/html");
    expect(await saved.text()).toContain('content="b1"');
  });

  it("never keeps a page of another deploy as the offline page", async () => {
    const sw = load("b1", onlineNet("b2"));
    await sw.fire("install");
    await sw.fire("fetch", nav("/"));
    expect(sw.caches.urls("bumelerze-app-b1")).not.toContain(`${ORIGIN}/__offline-shell`);
  });

  it("files: cache first once kept; the host's HTML answer for a missing file is never kept", async () => {
    const sw = load("b1", onlineNet("b1"));
    const chunk = `${ORIGIN}/_expo/static/js/web/home-b1.js`;
    await sw.fire("fetch", get(chunk));
    sw.fetches.length = 0;
    const again = (await sw.fire("fetch", get(chunk))) as Response;
    expect(await again.text()).toBe(chunk);
    expect(sw.fetches).toEqual([]);

    const missing = `${ORIGIN}/_expo/static/js/web/old-chunk-a0.js`;
    const answer = (await sw.fire("fetch", get(missing))) as Response;
    expect(answer.headers.get("content-type")).toContain("text/html");
    expect(sw.caches.urls("bumelerze-app-b1")).not.toContain(missing);
  });

  it("leaves other sites, POSTs, the catalogue database and non-hashed files alone", async () => {
    const sw = load("b1", onlineNet("b1"));
    expect(
      await sw.fire(
        "fetch",
        get("https://bcgyxepgruwardhozvfq.supabase.co/rest/v1/events"),
      ),
    ).toBeUndefined();
    expect(
      await sw.fire("fetch", get("https://earthquake.usgs.gov/fdsnws/event/1/query")),
    ).toBeUndefined();
    expect(
      await sw.fire("fetch", {
        request: {
          url: `${ORIGIN}/_expo/static/js/web/x-b1.js`,
          method: "POST",
          mode: "cors",
        },
      }),
    ).toBeUndefined();
    expect(
      await sw.fire(
        "fetch",
        get(`${ORIGIN}/assets/assets/catalog/bumelerze-catalog.c78e.sqlite`),
      ),
    ).toBeUndefined();
    expect(
      await sw.fire("fetch", get(`${ORIGIN}/maplibre-gl-worker.mjs?v=b1`)),
    ).toBeUndefined();
    expect(
      await sw.fire("fetch", {
        request: { url: "https://other.example/", method: "GET", mode: "navigate" },
      }),
    ).toBeUndefined();
  });

  it("answers which deploy it is", async () => {
    const sw = load("b1", onlineNet("b1"));
    const reply = jest.fn();
    await sw.fire("message", {
      data: { type: "bumelerze-version" },
      ports: [{ postMessage: reply }],
    });
    expect(reply).toHaveBeenCalledWith({ build: "b1", offline: true });
  });

  it("keeps the previous deploy until this one is complete, then deletes it", async () => {
    const shared = new FakeCaches();
    const first = load("b1", onlineNet("b1"), "on", shared);
    await first.fire("install");
    await first.fire("message", {
      data: {
        type: "bumelerze-keep",
        build: "b1",
        urls: [`${ORIGIN}/_expo/static/js/web/entry-b1.js`],
      },
    });
    expect(shared.urls("bumelerze-app-b1")).toContain(`${ORIGIN}/__offline-complete`);

    // Next deploy: installed and active, but no page of it has loaded yet.
    const second = load("b2", onlineNet("b2"), "on", shared);
    await second.fire("install");
    await second.fire("activate");
    expect([...shared.stores.keys()].sort()).toEqual([
      "bumelerze-app-b1",
      "bumelerze-app-b2",
    ]);

    // A page of the old deploy reporting does nothing for the new worker.
    await second.fire("message", {
      data: { type: "bumelerze-keep", build: "b1", urls: [] },
    });
    expect(shared.stores.has("bumelerze-app-b1")).toBe(true);

    // A page of the new deploy has loaded: complete, the old copy goes.
    await second.fire("message", {
      data: {
        type: "bumelerze-keep",
        build: "b2",
        urls: [`${ORIGIN}/_expo/static/js/web/home-b2.js`],
      },
    });
    expect([...shared.stores.keys()]).toEqual(["bumelerze-app-b2"]);
    expect(shared.urls("bumelerze-app-b2")).toContain(
      `${ORIGIN}/_expo/static/js/web/home-b2.js`,
    );
  });

  it("emergency switch: deletes its caches and stops answering page loads", async () => {
    const shared = new FakeCaches();
    const first = load("b1", onlineNet("b1"), "on", shared);
    await first.fire("install");
    const off = load("b2", onlineNet("b2"), "off", shared);
    await off.fire("install");
    await off.fire("activate");
    expect(shared.stores.size).toBe(0);
    expect(await off.fire("fetch", nav("/"))).toBeUndefined();
  });
});
