import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Expo Router bundles every route file under `app/` on every platform (its
 * iOS context also takes `*.web.tsx`). A route that imports MapLibre GL JS
 * put the whole web map library (about 1 MB) into the iOS bundle, so route
 * files reach it only through a platform twin (`@/features/map/WebMapTab`,
 * an empty module on iOS/Android).
 */
const APP = join(__dirname, "..", "..", "..", "..", "app");

function routeFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!entry.startsWith("__")) {
        routeFiles(full, files);
      }
    } else if (/\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("route files and the iOS bundle", () => {
  it("[regression] no route file imports maplibre-gl", () => {
    const offenders = routeFiles(APP)
      .filter((file) =>
        /["']maplibre-gl(?:\/[^"']*)?["']/.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(APP, file));
    expect(offenders).toEqual([]);
  });

  it("the web Map route only hands over to the platform twin", () => {
    const route = readFileSync(join(APP, "(tabs)", "(map)", "map.web.tsx"), "utf8");
    expect(route).toMatch(/from "@\/features\/map\/WebMapTab"/);
    expect(route).not.toMatch(/from ["'][^"']*WebMapTab\.web/);
  });
});
