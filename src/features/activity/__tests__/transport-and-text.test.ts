import i18n from "@/i18n";

import { activityDetail, activityHref, activityMessage, actorName } from "../text";
import { parseActivityRows } from "../transport";
import type { ActivityItem } from "../types";

const t = i18n.t.bind(i18n);

function row(overrides: Record<string, unknown> = {}) {
  return {
    item_id: "i1",
    kind: "new_follower",
    created_at: "2026-10-09T10:00:00Z",
    read_at: null,
    actor_id: "u-b",
    actor_username: "userb",
    actor_name: "Bnar",
    actor_avatar: null,
    item_count: 1,
    ...overrides,
  };
}

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    ...parseActivityRows([row()])[0]!,
    ...overrides,
  };
}

describe("parseActivityRows", () => {
  it("keeps the known fields, drops unknown kinds and bad dates", () => {
    const items = parseActivityRows([
      row(),
      row({ item_id: "i2", kind: "something_new" }),
      row({ item_id: "i3", created_at: "not a date" }),
      row({ item_id: "i4", email: "b@x.org", lat: 36.1 }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["i1", "i4"]);
    expect(JSON.stringify(items)).not.toMatch(/b@x\.org|36\.1|"lat"|"email"/);
    expect(items[0]).toMatchObject({
      kind: "new_follower",
      read: false,
      actor: { userId: "u-b", username: "userb", displayName: "Bnar" },
      count: 1,
    });
  });

  it("no actor for moderation rows; read when read_at is set; count at least 1", () => {
    const [removed] = parseActivityRows([
      row({
        kind: "content_removed",
        actor_id: null,
        actor_username: null,
        actor_name: null,
        read_at: "2026-10-09T11:00:00Z",
        target: "comment",
        action: "hide",
        reason: "spam",
        appealed: true,
        item_count: 0,
      }),
    ]);
    expect(removed).toMatchObject({
      actor: null,
      read: true,
      target: "comment",
      action: "hide",
      reason: "spam",
      appealed: true,
      count: 1,
    });
  });

  it("is safe with anything that is not a list", () => {
    expect(parseActivityRows(null)).toEqual([]);
    expect(parseActivityRows({ rows: [] })).toEqual([]);
  });
});

describe("activity text", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("names the person, a guest, or nobody", () => {
    expect(actorName(t, item())).toBe("Bnar");
    expect(
      actorName(
        t,
        item({
          actor: { userId: "g", username: null, displayName: null, avatarPath: null },
        }),
      ),
    ).toBe("A guest");
    expect(actorName(t, item({ actor: null }))).toBe("Someone");
  });

  it("words each kind calmly", () => {
    expect(activityMessage(t, item(), "en")).toBe("Bnar started following you.");
    expect(activityMessage(t, item({ kind: "comment_helpful", count: 3 }), "en")).toBe(
      "Your comment was marked Helpful (3).",
    );
    expect(
      activityMessage(
        t,
        item({ kind: "badge_granted", actor: null, role: "seismologist" }),
        "en",
      ),
    ).toBe("You received the Seismologist mark.");
    expect(
      activityMessage(
        t,
        item({ kind: "content_removed", actor: null, target: "comment", action: "hide" }),
        "en",
      ),
    ).toBe("A moderator hid your comment.");
    expect(
      activityMessage(
        t,
        item({ kind: "content_removed", actor: null, target: "post", action: "remove" }),
        "en",
      ),
    ).toBe("A moderator removed your post.");
    expect(
      activityMessage(
        t,
        item({ kind: "report_reviewed", actor: null, target: "profile" }),
        "en",
      ),
    ).toBe("We reviewed a profile you reported. Thank you.");
    expect(
      activityMessage(
        t,
        item({ kind: "home_join_request", homeLabel: "Our flat" }),
        "en",
      ),
    ).toBe("Bnar asked to join Our flat.");
    expect(
      activityMessage(
        t,
        item({ kind: "home_join_approved", homeLabel: null, homeCode: "BMH-ABC123" }),
        "en",
      ),
    ).toBe("You can now see BMH-ABC123.");
    expect(activityMessage(t, item({ kind: "family_safe" }), "en")).toBe(
      "Bnar checked in: I'm safe.",
    );
  });

  it("localizes the Helpful count's digits", () => {
    expect(
      activityMessage(t, item({ kind: "post_helpful", count: 12 }), "ckb"),
    ).toContain("١٢");
  });

  it("gives the reason of a removal (a report reason, else the guidelines)", () => {
    expect(activityDetail(t, item({ kind: "content_removed", reason: "spam" }))).toBe(
      "Reason: Spam or advertising",
    );
    expect(
      activityDetail(t, item({ kind: "content_removed", reason: "removed_by_admin" })),
    ).toBe("Reason: It goes against the community guidelines.");
    expect(activityDetail(t, item({ kind: "comment_reply", snippet: "Me too" }))).toBe(
      "“Me too”",
    );
    expect(activityDetail(t, item({ kind: "family_safe", place: "Halabja" }))).toBe(
      "Earthquake near Halabja",
    );
    expect(activityDetail(t, item())).toBeNull();
  });

  it("opens the right place, or nothing", () => {
    expect(activityHref(item())).toBe("/u/userb");
    expect(activityHref(item({ kind: "follow_request" }))).toBe("/account/people");
    expect(activityHref(item({ kind: "comment_reply", hubId: "bml2026aaa" }))).toBe(
      "/event-hub/bml2026aaa",
    );
    expect(activityHref(item({ kind: "family_safe", tagId: "t1" }))).toBe(
      "/home/t1/family",
    );
    expect(activityHref(item({ kind: "home_join_approved", tagId: "t1" }))).toBe(
      "/home/t1/report",
    );
    expect(activityHref(item({ kind: "badge_granted" }))).toBe("/badges");
    expect(activityHref(item({ kind: "report_reviewed" }))).toBeNull();
    expect(activityHref(item({ kind: "content_removed" }))).toBeNull();
    expect(
      activityHref(
        item({
          actor: { userId: "g", username: null, displayName: null, avatarPath: null },
        }),
      ),
    ).toBeNull();
  });
});
