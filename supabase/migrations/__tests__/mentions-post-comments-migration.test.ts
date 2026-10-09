import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0063 (comments on profile posts and @mentions).
 * Pasted into the SQL editor as one line, so the paste rules are pinned; so
 * are the promises: the new tables are closed to the app (functions only),
 * every write path runs the restriction, guidelines, word-filter and
 * busy-time rules, a mention never tells anybody about something they cannot
 * see, the shared check constraints grow as unions, and account deletion
 * blanks post comments. The behaviour was exercised against a real Postgres
 * (PGlite, 0001-0061 then 0063 twice, plus run53-run61 again) when it was
 * written; these keep it from being edited away.
 */
const raw = readMigration("0063_mentions_post_comments.sql");
const sql = readCode("0063_mentions_post_comments.sql");
const fn = (name: string) => functionSource(sql, name);

function tableBody(name: string): string {
  const start = sql.search(
    new RegExp(`create table if not exists public\\.${name}\\s*\\(`, "i"),
  );
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf(");", start));
}

describe("0063 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("has only full-line comments", () => {
    for (const line of sql.split("\n")) {
      expect(line).not.toContain("--");
    }
  });

  it("is plain ASCII and has no question marks (editors read ? as a parameter)", () => {
    expect(raw).not.toMatch(/[^\x00-\x7f]/);
    expect(sql).not.toContain("?");
  });

  it("is idempotent", () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/add column (?!if not exists)/i);
    for (const [trigger, table] of [
      ["mentions_after_write", "event_comments"],
      ["mentions_after_write", "profile_posts"],
      ["post_comments_before_insert", "post_comments"],
      ["post_comments_before_update", "post_comments"],
      ["post_comments_after_write", "post_comments"],
      ["post_comments_on_post_status", "profile_posts"],
      ["activity_on_post_comment_moderation", "moderation_log"],
    ] as const) {
      expect(sql).toContain(`drop trigger if exists ${trigger} on public.${table};`);
    }
    // a changed return shape is dropped first, by its exact signature
    expect(sql).toContain(
      "drop function if exists public.profile_posts_page(uuid, timestamptz, integer, boolean, uuid);",
    );
    expect(sql).toContain(
      "drop function if exists public.my_activity(integer, timestamptz);",
    );
  });

  it("never uses CASE inside an IF condition (PL/pgSQL takes its THEN as the IF's)", () => {
    // the condition is what lies between an IF (not "if exists", "end if")
    // and its own first THEN
    const conditions = [
      ...sql.matchAll(/(?<!end )\b(?:if|elsif)\b(?! (?:not )?exists\b)/gi),
    ].map((m) => {
      const rest = sql.slice((m.index ?? 0) + m[0].length);
      return rest.slice(0, rest.search(/\bthen\b/i));
    });
    expect(conditions.length).toBeGreaterThan(20);
    for (const condition of conditions) {
      expect(condition).not.toMatch(/\bcase\b/i);
    }
  });

  it("documents itself in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0063:/);
  });
});

describe("shared lists grow as unions, never a fixed list (0062 sits in between on live)", () => {
  it("rebuilds every shared check from the live definition", () => {
    const helper = fn("rebuild_check_union");
    expect(helper).toContain("pg_get_constraintdef(oid) like p_like");
    expect(helper).toContain("regexp_matches(c.def");
    for (const [table, like, name, values] of [
      [
        "moderation_log",
        "%comment_approve%",
        "moderation_log_action_check",
        "'post_comment_hide'",
      ],
      [
        "moderation_log",
        "%target_type%",
        "moderation_log_target_type_check",
        "'post_comment'",
      ],
      ["activity_items", "%new_follower%", "activity_items_kind_check", "'mention'"],
      [
        "content_holds",
        "%target_type%",
        "content_holds_target_type_check",
        "'post_comment'",
      ],
      [
        "moderation_evidence",
        "%kind%",
        "moderation_evidence_kind_check",
        "'post_comment'",
      ],
    ] as const) {
      const call = sql.slice(
        sql.indexOf(`'public.${table}'::regclass, '${like}', '${name}'`),
      );
      expect(call.length).toBeGreaterThan(0);
      expect(call.slice(0, 300)).toContain(values);
    }
    expect(sql).not.toMatch(/add constraint moderation_log_action_check/i);
    expect(sql).not.toMatch(/add constraint activity_items_kind_check/i);
  });

  it("depends on no object of 0062 (alerts)", () => {
    expect(sql).not.toMatch(/push_subscriptions|alert_queue|send-alerts|alerts\.test/);
  });

  it("wraps export_my_data instead of replacing what an earlier batch put in it", () => {
    expect(sql).toContain(
      "alter function public.export_my_data() rename to export_my_data_base;",
    );
    expect(sql).toContain("p.prosrc like '%export_my_data_base%'");
    const wrapper = fn("export_my_data");
    expect(wrapper).toContain("v_base := public.export_my_data_base();");
    for (const key of ["'post_comments'", "'mentions_made'", "'reports_made'"]) {
      expect(wrapper).toContain(key);
    }
    expect(sql).toContain(
      "revoke all on function public.export_my_data_base() from public, anon, authenticated;",
    );
  });

  it("leaves account deletion, 0061's moderation trigger and activity_add alone", () => {
    for (const name of [
      "delete_my_account",
      "activity_add",
      "activity_on_moderation",
      "block_user",
    ]) {
      expect(createdFunctions(sql)).not.toContain(name);
    }
  });
});

describe("the new tables are closed to the app", () => {
  it("creates exactly these tables, RLS on, every client privilege revoked, no policy", () => {
    expect(createdTables(sql).sort()).toEqual(
      ["mentions", "post_comment_reports", "post_comments"].sort(),
    );
    for (const table of ["post_comments", "post_comment_reports", "mentions"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(
        `revoke all on public.${table} from public, anon, authenticated;`,
      );
      expect(sql).not.toMatch(new RegExp(`create policy \\w+ on public\\.${table}`, "i"));
    }
  });

  it("stores no place, device or contact in them", () => {
    for (const table of ["post_comments", "post_comment_reports", "mentions"]) {
      expect(tableBody(table)).not.toMatch(
        /\b(lat|lon|geohash|device|email|phone|coord)/i,
      );
    }
  });

  it("caps a comment at 500 characters and a report note at 200", () => {
    expect(tableBody("post_comments")).toContain("char_length(body) <= 500");
    expect(tableBody("post_comment_reports")).toContain("char_length(note) <= 200");
  });

  it("keeps internal helpers away from every client role", () => {
    for (const name of [
      "can_read_post_as(uuid, uuid, text)",
      "can_read_post_comment(uuid, uuid)",
      "can_see_mention_source(uuid, text, uuid)",
      "mention_targets(text, uuid)",
      "sync_mentions(text, uuid, uuid, text)",
      "mention_refresh(text, uuid)",
      "mention_item_visible(uuid, text, uuid, uuid, uuid)",
      "post_comment_visible_count(uuid)",
      "activity_link_post_comment(uuid, text, uuid)",
      "purge_post_comments()",
    ]) {
      expect(sql).toContain(
        `revoke all on function public.${name} from public, anon, authenticated;`,
      );
      expect(sql).not.toMatch(
        new RegExp(
          `grant execute on function public\\.${name.replace(/[()]/g, "\\$&")} to (anon|authenticated)`,
        ),
      );
    }
  });
});

describe("who may comment", () => {
  const insert = fn("post_comments_before_insert");

  it("accounts with a @username only, never a guest", () => {
    expect(insert).toContain("not coalesce(u.is_anonymous, true)");
    expect(insert).toContain("post_comments: not_account");
    expect(insert).toContain("p.username is not null");
    expect(fn("add_post_comment")).toContain("not public.is_real_account()");
  });

  it("runs the restriction guard, the guidelines gate, the word filter and busy times", () => {
    expect(insert).toContain(
      "perform public.assert_not_restricted(new.user_id, 'post_comments');",
    );
    expect(insert).toContain(
      "perform public.assert_guidelines_accepted(new.user_id, 'post_comments');",
    );
    expect(insert).toContain("public.content_filter_matches(new.body)");
    expect(insert).toContain(
      "public.account_is_new(new.user_id) and public.surge_active()",
    );
    expect(insert).toContain("public.has_permission(new.user_id, 'comments.moderate')");
  });

  it("only who may read the post, never across a block, never with comments off", () => {
    expect(insert).toContain(
      "public.can_read_post_as(new.user_id, v_post.user_id, v_post.status)",
    );
    expect(insert).toContain("v_post.status <> 'visible'");
    expect(insert).toContain("post_comments: comments_off");
    expect(insert).toContain("public.blocked_between(new.user_id, v_parent.user_id)");
  });

  it("20 comments in 10 minutes, one level of replies, the server sets status and time", () => {
    expect(insert).toContain("interval '10 minutes'");
    expect(insert).toContain("v_recent >= 20");
    expect(insert).toContain("new.parent_id := v_parent.parent_id;");
    expect(insert).toContain("new.status := 'visible';");
    expect(insert).toContain("new.created_at := now();");
  });

  it("can_read_post_as is can_read_post for a given viewer", () => {
    const asViewer = fn("can_read_post_as");
    for (const piece of [
      "p_author = p_viewer and p_status <> 'deleted'",
      "p_status = 'visible'",
      "not public.blocked_between(p_viewer, p_author)",
      "not pr.is_private",
      "f.status = 'accepted'",
      "not public.is_suspended(p_author)",
    ]) {
      expect(asViewer).toContain(piece);
    }
  });
});

describe("reading comments", () => {
  const page = fn("post_comments_page");
  it("nothing when the caller may not read the post", () => {
    expect(page).toContain("not public.can_read_post(v_author, v_status)");
  });
  it("no one in a block, no suspended author, held ones for their author only", () => {
    expect(page).toContain("not public.blocked_between(v_uid, c.user_id)");
    expect(page).toContain("not public.is_suspended(c.user_id)");
    expect(page).toContain(
      "c.status = 'pending' and v_uid is not null and c.user_id = v_uid",
    );
    expect(page).toContain("c.author_deleted_at is null");
    expect(page).toContain("c.owner_deleted_at is null");
  });
  it("a removed comment carries no author and no text", () => {
    expect(page).toContain("case when c.status = 'removed' then null else c.user_id end");
    expect(page).toContain("case when c.status = 'removed' then '' else c.body end");
  });
  it("the post page carries the count and the switch", () => {
    const posts = fn("profile_posts_page");
    expect(posts).toContain("public.post_comment_visible_count(po.post_id)");
    expect(posts).toContain("comments_off boolean");
    expect(posts).toContain("public.can_read_post(po.user_id, po.status)");
  });
});

describe("mentions", () => {
  it("parses the 0045 username rule, not inside an email, at most 5, never the author", () => {
    const targets = fn("mention_targets");
    expect(targets).toContain("'(^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]{3,24})'");
    expect(targets).toContain("rtrim(c.name, '.')");
    expect(targets).toContain("limit 5");
    expect(targets).toContain("x.user_id is distinct from p_author");
  });

  it("tells only who can see the text, and takes it back otherwise", () => {
    const refresh = fn("mention_refresh");
    expect(refresh).toContain(
      "public.can_see_mention_source(r.mentioned_user_id, p_type, p_id)",
    );
    expect(refresh).toContain("delete from public.activity_items");
    expect(refresh).toContain("p_refresh => false");
    const source = fn("can_see_mention_source");
    expect(source).toContain("not public.blocked_between(p_viewer, c.user_id)");
    expect(source).toContain("not public.is_suspended(c.user_id)");
    expect(source).toContain("public.can_read_post_as(p_viewer, po.user_id, po.status)");
    expect(source).toContain("public.can_read_post_comment(p_viewer, p_id)");
  });

  it("is checked again whenever the list is read", () => {
    const visible = fn("activity_visible");
    expect(visible).toContain("public.mention_item_visible(");
    expect(visible).toContain("public.can_read_post_comment(p_user, a.post_comment_id)");
    // 0061's rules are all still there
    for (const piece of [
      "not public.blocked_between(p_user, a.actor_id)",
      "not public.has_muted(p_user, a.actor_id) and not public.is_suspended(a.actor_id)",
      "a.kind <> 'family_safe'",
      "a.kind <> 'comment_reply'",
      "a.kind <> 'post_helpful'",
    ]) {
      expect(visible).toContain(piece);
    }
  });

  it("re-parses on every write of the text and on status changes", () => {
    expect(sql).toContain(
      "after insert or update of status, body, user_id on public.event_comments",
    );
    expect(sql).toContain(
      "after insert or update of status, body, user_id on public.profile_posts",
    );
    // a bug in mentions never stops the comment or post itself
    expect(fn("mentions_after_write")).toContain("exception when others then");
  });

  it("suggestions never offer a blocked, suspended or unseen private account", () => {
    const suggest = fn("mention_suggestions");
    expect(suggest).toContain("not public.blocked_between(v_uid, p.user_id)");
    expect(suggest).toContain("not public.is_suspended(p.user_id)");
    expect(suggest).toContain("not p.is_private");
    expect(suggest).toContain("p.user_id <> v_uid");
    expect(suggest).toContain("limit 8");
    expect(fn("mention_lookup")).toContain(
      "not public.blocked_between(auth.uid(), p.user_id)",
    );
  });
});

describe("moderation, undo, evidence, audit", () => {
  it("moderators approve or hide, the official removes with evidence", () => {
    expect(fn("moderate_post_comment")).toContain("'comments.moderate'");
    const remove = fn("admin_remove_post_comment");
    expect(remove).toContain("'comments.delete'");
    expect(remove).toContain("insert into public.moderation_evidence");
    expect(remove).toContain("'post_comment_remove', 'post_comment'");
    // never the post's evidence slot (unique per post)
    expect(remove).not.toMatch(/moderation_evidence \([^)]*\bpost_id\b/);
  });

  it("restore follows the hub's split: hidden by moderators, removed by content.restore in 30 days", () => {
    const restore = fn("admin_restore_post_comment");
    expect(restore).toContain("'comments.moderate'");
    expect(restore).toContain("'content.restore'");
    expect(restore).toContain("interval '30 days'");
    expect(restore).toContain("reverted_by = v_new");
  });

  it("admin_undo_action keeps every earlier branch and adds the post comment ones", () => {
    const undo = fn("admin_undo_action");
    for (const branch of [
      "'post_comment_hide', 'post_comment_remove'",
      "'comment_hide', 'comment_remove'",
      "l.action = 'post_remove'",
      "'profile_reports_resolve', 'post_reports_dismiss'",
      "'restrict', 'suspend'",
      "l.action = 'profile_reset'",
      "l.action = 'role_revoke'",
    ]) {
      expect(undo).toContain(branch);
    }
  });

  it("the author hears why, reporters hear it was reviewed", () => {
    const trigger = fn("activity_on_post_comment_moderation");
    expect(trigger).toContain("'removed:post_comment:'");
    expect(trigger).toContain("public.activity_reviewed('post_comment'");
    expect(fn("request_content_review")).toContain(
      "coalesce(a.comment_id, a.post_comment_id, a.post_id)",
    );
  });

  it("owners and authors delete with 24 hours of Undo", () => {
    expect(fn("delete_post_comment")).toContain("'deleted_by_post_owner'");
    expect(fn("restore_post_comment")).toContain("interval '24 hours'");
    expect(fn("my_recently_deleted")).toContain("'post_comment'::text");
  });
});

describe("account deletion", () => {
  it("blanks a deleted account's post comments when the foreign key unlinks them", () => {
    const update = fn("post_comments_before_update");
    expect(update).toContain("old.user_id is not null and new.user_id is null");
    expect(update).toContain("new.body := '';");
    expect(update).toContain("new.hidden_reason := 'account_deleted';");
    expect(tableBody("post_comments")).toMatch(
      /user_id uuid references auth\.users \(id\) on delete set null/,
    );
  });

  it("mentions of and by the person cascade", () => {
    const body = tableBody("mentions");
    expect(body).toMatch(
      /mentioned_user_id uuid not null references auth\.users \(id\) on delete cascade/,
    );
    expect(body).toMatch(
      /author_id uuid not null references auth\.users \(id\) on delete cascade/,
    );
  });
});
