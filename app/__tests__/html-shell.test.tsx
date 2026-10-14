import * as fs from "node:fs";
import * as path from "node:path";

import { APP_ORIGIN, APP_SHARE_DESCRIPTION, OG_IMAGE_URL } from "@/config/urls";

import Root from "../+html";

/**
 * The page around the web app carries the link-preview tags (D-1) and
 * nothing that would colour Safari's bars. Two copies exist by necessity:
 * app/+html.tsx (what Expo renders for a static export) and
 * public/index.html (what Expo takes for the hosted single-page export);
 * both must say the same.
 */
// react-dom ships no types in this project; only the static renderer is needed.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- untyped, test only
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup(element: React.ReactElement): string;
};

jest.mock("expo-router/html", () => ({
  ScrollViewStyleReset: () => null,
}));

const rendered = renderToStaticMarkup(
  <Root>
    <div id="root" />
  </Root>,
);
const spa = fs.readFileSync(path.join(__dirname, "../../public/index.html"), "utf8");

describe.each([
  ["app/+html.tsx (static export)", rendered],
  ["public/index.html (single-page export)", spa],
])("%s", (_name, html) => {
  it("keeps a literal <head> for the build-id stamp, and the root element", () => {
    expect(html).toContain("<head>");
    expect(html).toMatch(/<div id="root"><\/div>/);
  });

  it("carries the Open Graph and Twitter preview tags", () => {
    const tag = (attr: string, name: string, content: string) =>
      new RegExp(`<meta ${attr}="${name}" content="${content.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*/?>`);
    expect(html).toMatch(tag("property", "og:title", "Bumelerze"));
    expect(html).toMatch(tag("property", "og:description", APP_SHARE_DESCRIPTION));
    expect(html).toMatch(tag("property", "og:image", OG_IMAGE_URL));
    expect(html).toMatch(tag("property", "og:url", `${APP_ORIGIN}/`));
    expect(html).toMatch(tag("name", "twitter:card", "summary_large_image"));
    expect(html).toMatch(tag("name", "twitter:image", OG_IMAGE_URL));
    expect(OG_IMAGE_URL).toBe("https://bumelerze.com/og-image.jpg");
  });

  it("sets no theme-color (the manifest decision: no red bars)", () => {
    expect(html).not.toContain("theme-color");
  });

  it("uses none of the banned wordings", () => {
    expect(html).not.toMatch(/ShakeMap|\bfree\b|did you feel it/i);
  });
});

it("public/index.html keeps Expo's placeholders so the CLI fills in title and language", () => {
  expect(spa).toContain("<title>%WEB_TITLE%</title>");
  expect(spa).toContain('<html lang="%LANG_ISO_CODE%">');
  expect(spa).toContain('<style id="expo-reset">');
});
