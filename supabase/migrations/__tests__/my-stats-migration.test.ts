import { readFileSync } from "fs";
import { join } from "path";

/**
 * Static checks of migration 0040 (`my_stats()`): the function is security
 * definer with a pinned search path, scoped to auth.uid(), executable by
 * signed-in (incl. anonymous-auth) users only, and returns exactly the shape
 * the client parses (`src/features/account/stats.ts`).
 */
const sql = readFileSync(join(__dirname, "..", "0040_my_stats.sql"), "utf8");
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("0040_my_stats.sql", () => {
  it("is security definer with a pinned search path and stable", () => {
    expect(code).toMatch(/security definer/i);
    expect(code).toMatch(/set search_path = public, pg_temp/i);
    expect(code).toMatch(/\bstable\b/i);
  });

  it("returns the seven columns the client reads, in order", () => {
    const columns = [
      "member_since timestamptz",
      "reports integer",
      "detailed_reports integer",
      "photo_reports integer",
      "comments integer",
      "helpful_received integer",
      "family_linked boolean",
    ];
    let at = code.indexOf("returns table");
    expect(at).toBeGreaterThan(-1);
    for (const column of columns) {
      const next = code.indexOf(column, at);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  it("filters everything by auth.uid() and never by a caller-supplied id", () => {
    expect(code).not.toMatch(/my_stats\s*\(\s*\w+/);
    expect(code.match(/auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it("reads the real column names", () => {
    expect(code).toMatch(/felt_reports r[\s\S]*r\.user_id = auth\.uid\(\)/);
    expect(code).toMatch(/felt_report_details d[\s\S]*d\.felt_report_id = r\.report_id/);
    expect(code).toMatch(/felt_photos ph[\s\S]*ph\.report_id = r\.report_id/);
    expect(code).toMatch(/event_comments c[\s\S]*c\.status = 'visible'/);
    expect(code).toMatch(/sum\(c\.helpful_count\)/);
    expect(code).toMatch(/home_members m[\s\S]*m\.status = 'approved'/);
    expect(code).toMatch(
      /select p\.created_at[\s\S]*public\.profiles p[\s\S]*p\.user_id = auth\.uid\(\)/,
    );
  });

  it("revokes from public and anon, grants execute to authenticated only", () => {
    expect(code).toMatch(
      /revoke all on function public\.my_stats\(\) from public, anon;/i,
    );
    expect(code).toMatch(
      /grant execute on function public\.my_stats\(\) to authenticated;/i,
    );
    expect(code).not.toMatch(/grant execute[^;]*\banon\b/i);
  });
});
