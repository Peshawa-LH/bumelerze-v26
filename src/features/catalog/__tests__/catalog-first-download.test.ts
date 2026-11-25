import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve, dirname } from "path";

/**
 * The web app's first download must not contain expo-sqlite. Since Expo SDK 58
 * importing it starts the database worker and fetches its engine (wa-sqlite,
 * about 640 KB) at once: in 26.4.16 that happened on every visit, on every
 * page, because the catalog route imported it and async routes are off (every
 * route is in the first download). The catalog's database screen is now its
 * own download (`area.ts`, opened through `area-loader.web.ts`).
 *
 * This walks what the web build bundles up front: every route under app/ and
 * everything it imports statically, resolved the way the web build does
 * (`.web.tsx` before `.tsx`, the `@/` alias). Dynamic `import()` is a separate
 * download and is not followed.
 */
const ROOT = join(__dirname, "..", "..", "..", "..");
const EXTENSIONS = [".web.tsx", ".web.ts", ".tsx", ".ts", ".js"];

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

/** Static imports and re-exports that bring code along (not `import type`). */
function staticImports(source: string): string[] {
  const specs: string[] = [];
  const pattern =
    /(?:^|\n)\s*(import|export)\s+(?!type\b)([^;'"]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1] === "export" && !match[2]) {
      continue;
    }
    specs.push(match[3] as string);
  }
  return specs;
}

function firstDownload(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = listFiles(join(ROOT, "app"));
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

  it("is walked from the routes (sanity: the root layout and the catalog route are in it)", () => {
    expect(files).toContain("app/_layout.tsx");
    expect(files).toContain("app/(tabs)/(home,map,sensor,profile,settings)/catalog.tsx");
    expect(graph.size).toBeGreaterThan(200);
  });

  it("[regression 26.4.16] never imports expo-sqlite (it would start the database worker on every visit)", () => {
    const offenders = [...graph.entries()]
      .filter(([, specs]) =>
        specs.some((spec) => spec === "expo-sqlite" || spec.startsWith("expo-sqlite/")),
      )
      .map(([file]) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("reaches the catalog's database screen only through its web loader (a separate download)", () => {
    expect(files).toContain("src/features/catalog/area-loader.web.ts");
    expect(files).not.toContain("src/features/catalog/area.ts");
    expect(files).not.toContain("src/features/catalog/CatalogDatabaseScreen.tsx");
    expect(files).not.toContain("src/features/catalog/use-catalog.ts");
  });
});
