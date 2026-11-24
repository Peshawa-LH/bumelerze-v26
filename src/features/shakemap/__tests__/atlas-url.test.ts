import { ATLAS_BASE_URL, LEGACY_ATLAS_BASE_URL, atlasUrlOrNull } from "../config";

/** Security audit APP-08: an address from server data may be fetched or
 * offered as "Download report" only when it is a file inside the Atlas. */
describe("atlasUrlOrNull", () => {
  it("the Atlas lives on its own host since 2026-11 (B2.4)", () => {
    expect(ATLAS_BASE_URL).toBe("https://atlas.bumelerze.com");
    expect(LEGACY_ATLAS_BASE_URL).toBe("https://peshawa-lh.github.io/bumelerze-atlas");
  });

  it("keeps an https file inside the Atlas", () => {
    const url = `${ATLAS_BASE_URL}/events/us6000jllz/v5/report.pdf`;
    expect(atlasUrlOrNull(url)).toBe(url);
  });

  it("reads a file published under the old GitHub address from the Atlas host", () => {
    expect(
      atlasUrlOrNull(`${LEGACY_ATLAS_BASE_URL}/events/us6000jllz/v5/cont_damage.json`),
    ).toBe("https://atlas.bumelerze.com/events/us6000jllz/v5/cont_damage.json");
    expect(atlasUrlOrNull(`  ${LEGACY_ATLAS_BASE_URL}/v5/report.pdf?x=1#p2 `)).toBe(
      "https://atlas.bumelerze.com/v5/report.pdf?x=1#p2",
    );
  });

  it.each([
    ["another site", "https://example.test/events/x/report.pdf"],
    [
      "another project on the old host",
      "https://peshawa-lh.github.io/other-repo/report.pdf",
    ],
    [
      "a look-alike folder",
      "https://peshawa-lh.github.io/bumelerze-atlas-fake/report.pdf",
    ],
    ["the old folder without a file", "https://peshawa-lh.github.io/bumelerze-atlas"],
    ["a look-alike host", "https://atlas.bumelerze.com.evil.test/events/x/report.pdf"],
    ["another bumelerze.com host", "https://app.bumelerze.com/events/x/report.pdf"],
    ["plain http", "http://atlas.bumelerze.com/report.pdf"],
    [
      "plain http on the old host",
      "http://peshawa-lh.github.io/bumelerze-atlas/report.pdf",
    ],
    ["a user name in the address", "https://evil@atlas.bumelerze.com/report.pdf"],
    [
      "a user name on the old host",
      "https://evil@peshawa-lh.github.io/bumelerze-atlas/report.pdf",
    ],
    ["a way out of the old folder", `${LEGACY_ATLAS_BASE_URL}/../other-repo/report.pdf`],
    ["javascript", "javascript:alert(1)"],
    ["an Android intent", "intent://x#Intent;end"],
    ["not an address", "not a url"],
  ])("refuses %s", (_label, url) => {
    expect(atlasUrlOrNull(url)).toBeNull();
  });
});
