import { readFileSync } from "fs";
import { join } from "path";

/**
 * Static checks of migration 0049 (`delete_home_tag`): owners only, security
 * definer with a pinned search path, executable by signed-in users only, and
 * the building complex goes when its last tag does.
 */
const sql = readFileSync(join(__dirname, "..", "0049_delete_home_tag.sql"), "utf8");
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const migration0037 = readFileSync(join(__dirname, "..", "0037_home_tags.sql"), "utf8");
const migration0042 = readFileSync(join(__dirname, "..", "0042_home_photos.sql"), "utf8");

describe("0049_delete_home_tag.sql", () => {
  it("is security definer with a pinned search path", () => {
    expect(code).toMatch(
      /create or replace function public\.delete_home_tag\(p_tag uuid\)/i,
    );
    expect(code).toMatch(/returns void/i);
    expect(code).toMatch(/security definer/i);
    expect(code).toMatch(/set search_path = public, pg_temp/i);
  });

  it("refuses anyone who is not the tag's owner, before deleting anything", () => {
    const check = code.indexOf("not public.is_home_owner(p_tag)");
    expect(check).toBeGreaterThan(-1);
    expect(code).toMatch(/owners only'\s+using errcode = '42501'/i);
    expect(code.indexOf("delete from public.home_tags")).toBeGreaterThan(check);
  });

  it("deletes the tag and relies on cascades for everything under it", () => {
    expect(code).toMatch(/delete from public\.home_tags where tag_id = p_tag/i);
    // The children it depends on must really cascade.
    const cascades = migration0037.match(
      /references public\.home_tags \(tag_id\) on delete cascade/g,
    );
    expect(cascades?.length).toBeGreaterThanOrEqual(4);
    expect(migration0042).toMatch(
      /tag_id uuid not null references public\.home_tags \(tag_id\) on delete cascade/,
    );
  });

  it("drops the building complex only when no other tag is left in it", () => {
    expect(code).toMatch(/select complex_id into v_complex from public\.home_tags/i);
    expect(code).toMatch(
      /not exists \(select 1 from public\.home_tags where complex_id = v_complex\)/i,
    );
    expect(code).toMatch(
      /delete from public\.building_complexes where complex_id = v_complex/i,
    );
    // The complex is read before the tag is deleted (the FK then nulls it).
    expect(code.indexOf("select complex_id into v_complex")).toBeLessThan(
      code.indexOf("delete from public.home_tags"),
    );
  });

  it("is revoked from public and anon and granted to signed-in users only", () => {
    expect(code).toMatch(
      /revoke all on function public\.delete_home_tag\(uuid\) from public, anon;/i,
    );
    expect(code).toMatch(
      /grant execute on function public\.delete_home_tag\(uuid\) to authenticated;/i,
    );
    expect(code).not.toMatch(/to anon/i);
  });

  it("does not touch storage.objects (protected from SQL)", () => {
    expect(code).not.toMatch(/storage\.objects/i);
  });
});
