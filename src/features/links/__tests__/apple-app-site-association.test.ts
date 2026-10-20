/**
 * scripts/write-apple-app-site-association.mjs (run by
 * scripts/build-app-web.sh only when APPLE_TEAM_ID is set): the file that
 * lets app.bumelerze.com links open the iPhone app and shares saved
 * passwords with it. Checked against the links the app really shares.
 */
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { buildJoinLink } from "@/features/building/constants";
import { buildShareUrl } from "@/features/share/caption";
import { SHARE_PROFILE_URL_BASE } from "@/features/share/config";
import { APP_LINK_HOST, resolveIncomingLink } from "../incoming";

const ROOT = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(ROOT, "scripts/write-apple-app-site-association.mjs");
const TEAM_ID = "ABCDE12345";

interface Aasa {
  applinks: {
    details: { appIDs: string[]; components: { "/": string; comment?: string }[] }[];
  };
  webcredentials: { apps: string[] };
}

function printed(teamId: string): Aasa {
  return JSON.parse(
    execFileSync(process.execPath, [SCRIPT, "--print", teamId], { encoding: "utf8" }),
  ) as Aasa;
}

/** Apple's component pattern: `*` is any run of characters, `?` one. */
function matchesComponent(pattern: string, pathname: string): boolean {
  const source = pattern
    .split("")
    .map((ch) =>
      ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${source}$`).test(pathname);
}

function pathnameOf(url: string): string {
  const match = /^https:\/\/[^/]+([^?#]*)/.exec(url);
  return match?.[1] ?? "";
}

describe("apple-app-site-association", () => {
  const aasa = printed(TEAM_ID);
  const components = aasa.applinks.details[0]?.components ?? [];
  const opensInApp = (pathname: string) =>
    components.some((component) => matchesComponent(component["/"], pathname));

  it("names this app (Team ID + the bundle id in app.config.ts) for links and passwords", () => {
    const config = fs.readFileSync(path.join(ROOT, "app.config.ts"), "utf8");
    const bundleId = /bundleIdentifier:\s*"([^"]+)"/.exec(config)?.[1];
    expect(bundleId).toBe("org.bumelerze.app");
    expect(aasa.applinks.details).toHaveLength(1);
    expect(aasa.applinks.details[0]?.appIDs).toEqual([`${TEAM_ID}.${bundleId}`]);
    expect(aasa.webcredentials.apps).toEqual([`${TEAM_ID}.${bundleId}`]);
  });

  it("opens every link the app shares or prints in a QR code, on the screen the web shows", () => {
    const shared = [
      buildShareUrl("bml20170001"),
      `${SHARE_PROFILE_URL_BASE}/peshawa`,
      buildJoinLink("AB12CD", "k3y"),
      `https://${APP_LINK_HOST}/event/bml20170001`,
      `https://${APP_LINK_HOST}/event-hub/bml20170001`,
    ];
    for (const url of shared) {
      expect(url.startsWith(`https://${APP_LINK_HOST}/`)).toBe(true);
      expect({ url, opensInApp: opensInApp(pathnameOf(url)) }).toEqual({
        url,
        opensInApp: true,
      });
      expect(resolveIncomingLink(url).kind).toBe("route");
    }
  });

  it.each([
    "/",
    "/data/faults.geojson",
    "/_expo/static/js/web/entry.js",
    "/assets/vendor/icons.ttf",
    "/push-sw.js",
    "/.well-known/apple-app-site-association",
    "/admin",
  ])("leaves %s on the web", (pathname) => {
    expect(opensInApp(pathname)).toBe(false);
  });

  it("writes the file and its JSON content type for Cloudflare Pages", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "aasa-"));
    try {
      fs.writeFileSync(path.join(outDir, "_headers"), "/*\n  X-Frame-Options: DENY\n");
      execFileSync(process.execPath, [SCRIPT, outDir, TEAM_ID], { stdio: "pipe" });
      const written = JSON.parse(
        fs.readFileSync(
          path.join(outDir, ".well-known/apple-app-site-association"),
          "utf8",
        ),
      ) as Aasa;
      expect(written).toEqual(aasa);
      expect(fs.readFileSync(path.join(outDir, "_headers"), "utf8")).toBe(
        "/*\n  X-Frame-Options: DENY\n" +
          "\n/.well-known/apple-app-site-association\n  Content-Type: application/json\n",
      );
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("refuses anything that is not a Team ID, and writes nothing", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "aasa-"));
    try {
      fs.writeFileSync(path.join(outDir, "_headers"), "");
      const result = spawnSync(process.execPath, [SCRIPT, outDir, 'abc"; rm -rf /'], {
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(fs.existsSync(path.join(outDir, ".well-known"))).toBe(false);
      expect(fs.readFileSync(path.join(outDir, "_headers"), "utf8")).toBe("");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("is written by the web build only when APPLE_TEAM_ID is set", () => {
    const build = fs.readFileSync(path.join(ROOT, "scripts/build-app-web.sh"), "utf8");
    expect(build).toMatch(
      /if \[ -n "\$\{APPLE_TEAM_ID:-\}" \]; then\n\s+node scripts\/write-apple-app-site-association\.mjs dist-app "\$APPLE_TEAM_ID"\nfi/,
    );
    // The repository's own hosting files stay as they are: nothing about it
    // is in public/, so a build without the Team ID is unchanged.
    expect(fs.existsSync(path.join(ROOT, "public/.well-known"))).toBe(false);
    expect(fs.readFileSync(path.join(ROOT, "public/_headers"), "utf8")).not.toMatch(
      /apple-app-site-association/,
    );
  });
});
