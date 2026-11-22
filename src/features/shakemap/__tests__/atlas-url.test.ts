import { ATLAS_BASE_URL, atlasUrlOrNull } from "../config";

/** Security audit APP-08: an address from server data may be fetched or
 * offered as "Download report" only when it is a file inside the Atlas. */
describe("atlasUrlOrNull", () => {
  it("keeps an https file inside the Atlas", () => {
    const url = `${ATLAS_BASE_URL}/events/us6000jllz/v5/report.pdf`;
    expect(atlasUrlOrNull(url)).toBe(url);
  });

  it.each([
    ["another site", "https://example.test/events/x/report.pdf"],
    ["another project on the same host", "https://peshawa-lh.github.io/other-repo/report.pdf"],
    ["a look-alike folder", "https://peshawa-lh.github.io/bumelerze-atlas-fake/report.pdf"],
    ["plain http", "http://peshawa-lh.github.io/bumelerze-atlas/report.pdf"],
    ["a user name in the address", "https://evil@peshawa-lh.github.io/bumelerze-atlas/report.pdf"],
    ["a way out of the folder", `${ATLAS_BASE_URL}/../other-repo/report.pdf`],
    ["javascript", "javascript:alert(1)"],
    ["an Android intent", "intent://x#Intent;end"],
    ["not an address", "not a url"],
  ])("refuses %s", (_label, url) => {
    expect(atlasUrlOrNull(url)).toBeNull();
  });
});
