import { parseQueue, parseReportedProfiles, parseRoleHolders } from "../transport";
import { GRANTABLE_RANKS } from "../types";

describe("admin parsers", () => {
  it("reads the review queue and drops malformed rows", () => {
    const rows = parseQueue([
      {
        comment_id: "c1",
        event_id: "e1",
        hub_id: "bml202610aa",
        author_id: "u1",
        author_name: "Dilan",
        body: "hello",
        status: "pending",
        flag_count: 0,
        created_at: "2026-10-07T10:00:00Z",
      },
      { comment_id: "c2", status: "removed" },
      "junk",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "c1", hubId: "bml202610aa", status: "pending" });
  });

  it("reads role holders and ignores unknown ranks", () => {
    const rows = parseRoleHolders([
      {
        holder_id: "u1",
        username: "dilan",
        display_name: "Dilan",
        role: "professor",
        org_name: null,
        granted_at: "2026-10-07T10:00:00Z",
        granted_by_name: "Bumelerze team",
        note: "checked by email",
      },
      { holder_id: "u2", role: "wizard", granted_at: "2026-10-07T10:00:00Z" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "professor", grantedByName: "Bumelerze team" });
  });

  it("reads reported profiles", () => {
    expect(
      parseReportedProfiles([
        {
          reported_id: "u1",
          username: "x",
          display_name: "X",
          report_count: 3,
          last_reason: "spam",
        },
      ]),
    ).toEqual([
      {
        userId: "u1",
        username: "x",
        displayName: "X",
        reportCount: 3,
        lastReason: "spam",
      },
    ]);
  });

  it("never offers the official rank for granting", () => {
    expect(GRANTABLE_RANKS).not.toContain("official");
    expect(GRANTABLE_RANKS).toEqual([
      "moderator",
      "seismologist",
      "professor",
      "researcher",
      "engineer",
      "partner",
    ]);
  });
});
