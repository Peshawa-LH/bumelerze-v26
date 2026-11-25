import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve, dirname } from "path";

/**
 * The catalog's database must not start on every visit. Since Expo SDK 58,
 * loading expo-sqlite on the web schedules its database worker and with it the
 * SQLite engine (wa-sqlite, about 640 KB) for the next turn: in 26.4.16 that
 * happened on every visit, on every page. Two things keep it to the catalog:
 *
 * - The catalog's database screen is its own download (`area.ts`, opened
 *   through `area-loader.web.ts` only when the catalog is shown).
 * - `index.js` still loads expo-sqlite on the web (the worker shares a few
 *   modules with the app, which must sit in the first download; see there),
 *   and cancels that head start right away, through expo-sqlite's own key.
 *
 * This walks what the web build bundles up front: `index.js`, every route
 * under app/ and everything they load statically (`import`, `export … from`,
 * `require("…")`), resolved the way the web build does (`.web.tsx` before
 * `.tsx`, the `@/` alias). Dynamic `import()` is a separate download and is
 * not followed.
 */
const ROOT = join(__dirname, "..", "..", "..", "..");
const EXTENSIONS = [".web.tsx", ".web.ts", ".tsx", ".ts", ".js"];
const HEAD_START_KEY = "expo-sqlite.webWorkerStart";

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return /^(__tests__|__fixtures__|node_modules)$/.test(name) ? [] : listFiles(full);
    }
    return /\.(tsx?|js)$/.test(name) && !/\.(test|native|ios|android)\./.test(name)
      ? [full]
      : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = join(ROOT, "src", spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = resolve(dirname(from), spec);
  } else {
    return null; // a package
  }
  for (const candidate of [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => join(base, "index" + ext)),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/** What a file loads statically and so brings along (not `import type`). */
function staticImports(source: string): string[] {
  const specs: string[] = [];
  const declarations =
    /(?:^|\n)\s*(import|export)\s+(?!type\b)([^;'"]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(declarations)) {
    if (match[1] === "export" && !match[2]) {
      continue;
    }
    specs.push(match[3] as string);
  }
  for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    specs.push(match[1] as string);
  }
  return specs;
}

function firstDownload(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [join(ROOT, "index.js"), ...listFiles(join(ROOT, "app"))];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (graph.has(file)) {
      continue;
    }
    const specs = staticImports(readFileSync(file, "utf8"));
    graph.set(file, specs);
    for (const spec of specs) {
      const target = resolveImport(file, spec);
      if (target && /\.(tsx?|js)$/.test(target)) {
        queue.push(target);
      }
    }
  }
  return graph;
}

describe("the web app's first download", () => {
  const graph = firstDownload();
  const files = [...graph.keys()].map((file) => relative(ROOT, file));
  const entry = readFileSync(join(ROOT, "index.js"), "utf8");

  it("is walked from the entry and the routes (sanity)", () => {
    expect(files).toContain("index.js");
    expect(files).toContain("app/_layout.tsx");
    expect(files).toContain("app/(tabs)/(home,map,sensor,profile,settings)/catalog.tsx");
    expect(graph.size).toBeGreaterThan(200);
  });

  it("[regression 26.4.16] loads expo-sqlite only in index.js, nowhere else", () => {
    const loaders = [...graph.entries()]
      .filter(([, specs]) =>
        specs.some((spec) => spec === "expo-sqlite" || spec.startsWith("expo-sqlite/")),
      )
      .map(([file]) => relative(ROOT, file));
    expect(loaders).toEqual(["index.js"]);
  });

  it("[regression 26.4.16] index.js cancels the worker's head start right after loading it", () => {
    const load = entry.indexOf('require("expo-sqlite")');
    const cancel = entry.indexOf("clearTimeout(globalThis[workerHeadStart])");
    expect(load).toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(load);
    expect(entry).toContain(`Symbol.for("${HEAD_START_KEY}")`);
  });

  it("expo-sqlite still keeps that head start under the same key (tripwire for upgrades)", () => {
    const module = readFileSync(
      join(ROOT, "node_modules", "expo-sqlite", "web", "SQLiteModule.ts"),
      "utf8",
    );
    expect(module).toContain(`Symbol.for('${HEAD_START_KEY}')`);
    expect(module).toMatch(/globals\[workerStartHandle\] = setTimeout\(/);
  });

  it("reaches the catalog's database screen only through its web loader (a separate download)", () => {
    expect(files).toContain("src/features/catalog/area-loader.web.ts");
    expect(files).not.toContain("src/features/catalog/area.ts");
    expect(files).not.toContain("src/features/catalog/CatalogDatabaseScreen.tsx");
    expect(files).not.toContain("src/features/catalog/use-catalog.ts");
  });
});
