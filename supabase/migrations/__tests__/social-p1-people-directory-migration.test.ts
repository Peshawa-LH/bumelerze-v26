import {
  createdFunctions,
  createdTables,
  functionSource,
  readCode,
  readMigration,
} from "../sql-test-utils";

/**
 * Static checks of migration 0055 (social + admin P1, batch 4: the People and
 * devices directory). It is applied by hand in the SQL editor as one line, so
 * these pin down what must not drift: the paste-ability, the permission split,
 * the privacy of the two new tables, that nothing secret can come back from an
 * admin function (no coordinates, raw device ids, tokens, hashes, feedback
 * text), the audit rows, and the idempotency of presence, reset and notes.
 * (The behaviour was exercised against a real Postgres when it was written;
 * these keep it from being edited away.)
 */
const raw = readMigration("0055_social_p1_people_directory.sql");
const sql = readCode("0055_social_p1_people_directory.sql");
const fn = (name: string) => functionSource(sql, name);

describe("0055 can be pasted into the SQL editor as one line", () => {
  it("has no transaction statements", () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("has only full-line comments (no inline -- that would swallow the rest of the line)", () => {
    for (const line of sql.split("\n")) {
      expect(line).not.toContain("--");
    }
  });

  it("is plain ASCII", () => {
    expect(raw).not.toMatch(/[^\x00-\x7f]/);
  });

  it("never uses the ? jsonb operator (editors read it as a parameter)", () => {
    expect(sql).not.toMatch(/\s\?\s*'/);
  });

  it("is idempotent", () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create index (?!if not exists)/i);
    expect(sql).not.toMatch(/create function/i);
    for (const m of sql.matchAll(/add constraint (\w+)/gi)) {
      expect(sql).toMatch(new RegExp(`drop constraint if exists ${m[1]}`, "i"));
    }
    expect(sql).toMatch(/on conflict do nothing/);
  });

  it("documents itself and the permission split in a header", () => {
    expect(raw.split("\n")[0]).toMatch(/^-- 0055:/);
    expect(raw).toMatch(/Who may do what:/);
    expect(raw).toMatch(/Never returned by any function here/);
  });
});

describe("permissions", () => {
  const insert = sql.match(
    /insert into public\.role_permissions[\s\S]*?on conflict do nothing;/,
  )?.[0] as string;

  it("gives people.view to moderator and official, email and guests to official only", () => {
    expect(insert).toMatch(/\('moderator', 'people\.view'\)/);
    expect(insert).toMatch(/\('official', 'people\.view'\)/);
    expect(insert).toMatch(/\('official', 'people\.view_email'\)/);
    expect(insert).toMatch(/\('official', 'people\.view_guests'\)/);
    expect(insert).not.toMatch(/\('moderator', 'people\.view_/);
  });

  it("every admin function checks its permission first", () => {
    for (const name of [
      "admin_people_search",
      "admin_person",
      "admin_people_stats",
      "admin_add_person_note",
      "admin_person_notes",
    ]) {
      expect(fn(name)).toMatch(/has_permission\(v_uid, 'people\.view'\)/);
    }
    expect(fn("admin_reveal_email")).toMatch(/has_permission\(v_uid, 'people\.view_email'\)/);
    expect(fn("admin_reset_profile_fields")).toMatch(
      /has_permission\(v_uid, 'accounts\.restrict'\)/,
    );
  });

  it("a moderator cannot reach guests: kind guests is refused, 'all' becomes accounts, a guest page is not found", () => {
    const search = fn("admin_people_search");
    expect(search).toMatch(/v_kind = 'guests' and not v_guests/);
    expect(search).toMatch(/v_kind = 'all' and not v_guests[\s\S]*v_kind := 'accounts'/);
    expect(search).toMatch(/v_guests or not coalesce\(u\.is_anonymous, false\)/);
    expect(fn("admin_person")).toMatch(/u\.guest and not v_guests[\s\S]*not_found/);
    expect(fn("admin_people_stats")).toMatch(/case when v_guests/);
  });

  it("emails: masked only for people.view_email, searched only for them", () => {
    const search = fn("admin_people_search");
    expect(search).toMatch(/v_by_mail := v_email and/);
    expect(search).toMatch(/when v_email then jsonb_build_object\(\s*'masked_email'/);
    expect(fn("admin_person")).toMatch(/case when v_email then jsonb_build_object\(\s*'masked_email'/);
  });

  it("password filter needs accounts.reset_password", () => {
    expect(fn("admin_people_search")).toMatch(/has_password[\s\S]*not v_pw[\s\S]*not_allowed/);
  });
});

describe("new tables are private", () => {
  it("adds app_presence and admin_person_notes only", () => {
    expect(createdTables(sql).sort()).toEqual(["admin_person_notes", "app_presence"]);
  });

  it.each(["app_presence", "admin_person_notes"])("%s has RLS, no policy and no client privilege", (t) => {
    expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
    expect(sql).toMatch(new RegExp(`revoke all on public\\.${t} from anon, authenticated`));
    expect(sql).not.toMatch(new RegExp(`create policy \\w+ on public\\.${t}`, "i"));
    expect(sql).not.toMatch(new RegExp(`grant [^;]*on public\\.${t} to`, "i"));
  });

  it("notes are capped at 1000 characters and cascade with the person", () => {
    expect(sql).toMatch(/char_length\(btrim\(body\)\) between 1 and 1000/);
    expect(sql).toMatch(/user_id uuid not null references auth\.users \(id\) on delete cascade/);
  });
});

describe("presence", () => {
  const touch = fn("touch_presence");

  it("is a once-a-day heartbeat: a second call within 20 hours changes nothing", () => {
    expect(touch).toMatch(/where a\.last_seen < now\(\) - interval '20 hours'/);
  });

  it("needs a signed-in identity and drops values it does not know instead of failing", () => {
    expect(touch).toMatch(/v_uid is null[\s\S]*not_allowed/);
    expect(touch).toMatch(/p_platform in \('ios', 'android', 'web'\)/);
    expect(touch).toMatch(/p_locale in \('en', 'ckb', 'kmr', 'ar'\)/);
  });

  it("is callable by signed-in identities only", () => {
    expect(sql).toMatch(/revoke all on function public\.touch_presence\(text, text, text\) from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.touch_presence\(text, text, text\) to authenticated/);
  });
});

describe("fingerprints, not device ids", () => {
  it("the fingerprint is the first 8 hex characters of a sha256 and is internal", () => {
    expect(fn("device_fingerprint")).toMatch(/left\(encode\(sha256\(convert_to\(p_device, 'UTF8'\)\), 'hex'\), 8\)/);
    expect(sql).toMatch(/revoke all on function public\.device_fingerprint\(text\) from public, anon, authenticated/);
  });

  it("no JSON key is ever filled with a device id; the only device value is the fingerprint", () => {
    for (const name of ["admin_people_search", "admin_person"]) {
      const body = fn(name);
      expect(body).not.toMatch(/'device_id'/);
      // every key/value pair that mentions a device takes the fingerprint
      for (const m of body.matchAll(/'(\w*device\w*|fingerprint)',\s*([^\n]*)/g)) {
        if (m[1] === "fingerprint") {
          expect(m[2]).toMatch(/^(x\.fp|public\.device_fingerprint\()/);
        }
      }
    }
    expect(fn("admin_person")).toMatch(/'fingerprint', x\.fp/);
    expect(fn("admin_person")).toMatch(/'fingerprint', public\.device_fingerprint\(o\.device_id\)/);
  });
});

describe("nothing secret can come back", () => {
  const readers = ["admin_people_search", "admin_person", "admin_people_stats", "admin_person_notes"];
  const forbidden: [string, RegExp][] = [
    ["coordinates", /\b(lat|lon|latitude|longitude|geohash\w*|area_geohash)\b/i],
    ["home join keys", /join_key|home_tag_secrets/i],
    ["survey answers", /home_surveys|home_assessments|\banswers\b/i],
    ["home photos", /home_photos|felt_photos|feedback_photos/i],
    ["profession", /\bprofession\b/i],
    ["push tokens and alert places", /notification_subscriptions|push_token|expo_push/i],
    ["feedback text and contact", /\b(f|fb|fb2|x)\.(message|contact)\b|feedback\.(message|contact)/i],
    ["password hashes", /encrypted_password(?![\s\S]{0,12}(is not null|<>))/i],
    ["IP addresses", /\bip_address\b|\bsessions\b|auth\.sessions/i],
  ];

  it.each(readers)("%s never names a secret column", (name) => {
    const body = fn(name);
    for (const [label, pattern] of forbidden) {
      expect({ label, found: pattern.test(body) }).toEqual({ label, found: false });
    }
  });

  it("the only use of the password column is 'is there one'", () => {
    for (const name of ["admin_people_search", "admin_person"]) {
      for (const m of fn(name).matchAll(/encrypted_password[^,)]*/g)) {
        expect(m[0]).toMatch(/is not null and [a-z.]*encrypted_password <> ''/);
      }
    }
  });

  it("felt reports are listed by time, event and intensity only", () => {
    const body = fn("admin_person");
    expect(body).toMatch(/'report_id', r\.report_id,\s*'created_at', r\.created_at,\s*'event', e\.bumelerze_id,\s*'intensity', r\.cartoon_level/);
  });

  it("removed text comes only from the evidence copy and only with audit.read_all; an author's own delete is never shown", () => {
    const body = fn("admin_person");
    expect(body).toMatch(/v_evidence := public\.has_permission\(v_uid, 'audit\.read_all'\)/);
    expect(body).toMatch(/when c\.author_deleted_at is not null then null/);
    expect(body).toMatch(/case when v_evidence then[\s\S]*moderation_evidence/);
  });

  it("guests without any activity are counted, not listed", () => {
    const search = fn("admin_people_search");
    expect(search).toMatch(/not f\.guest or f\.has_activity/);
    expect(search).toMatch(/'idle_guests'/);
    expect(fn("guest_has_activity")).toMatch(/felt_reports[\s\S]*event_comments[\s\S]*feedback[\s\S]*comment_flags[\s\S]*profile_reports[\s\S]*post_reports[\s\S]*blocks[\s\S]*account_restrictions/);
  });

  it("paging is keyset, 50 at most", () => {
    const search = fn("admin_people_search");
    expect(search).toMatch(/least\(greatest\(coalesce\(p_limit, 50\), 1\), 50\)/);
    expect(search).toMatch(/\(f\.k, f\.uid\) < \(v_ck, v_cid\)/);
  });

  it("LIKE patterns are escaped", () => {
    expect(fn("people_like_escape")).toMatch(/replace\(replace\(replace/);
    expect(fn("admin_people_search")).toMatch(/people_like_escape/);
  });
});

describe("audit", () => {
  it("opening a person writes person_view (target_type account), once per 5 minutes per admin and person", () => {
    const body = fn("admin_person");
    expect(body).toMatch(/l\.action = 'person_view'/);
    expect(body).toMatch(/interval '5 minutes'/);
    expect(body).toMatch(/write_audit\(\s*v_uid, 'person_view', 'account'/);
  });

  it("revealing an email writes email_reveal every time", () => {
    const body = fn("admin_reveal_email");
    expect(body).toMatch(/write_audit\(\s*v_uid, 'email_reveal', 'account'/);
    expect(body).not.toMatch(/interval/);
  });

  it("the log learns profile_restore, and moderators may read name/photo resets", () => {
    expect(sql).toMatch(/'password_reset', 'profile_reset', 'profile_restore'/);
    expect(fn("is_content_audit_action")).toMatch(/'profile_reset', 'profile_restore'/);
    expect(fn("is_content_audit_action")).not.toMatch(/person_view|email_reveal|password_reset/);
  });
});

describe("name and photo reset", () => {
  const reset = fn("admin_reset_profile_fields");

  it("refuses yourself and anyone who holds an admin permission", () => {
    expect(reset).toMatch(/self_reset/);
    expect(reset).toMatch(/holds_admin_permission\(p_user_id\)[\s\S]*protected_account/);
  });

  it("only name and photo; the photo file is kept so Undo can bring it back", () => {
    expect(reset).toMatch(/'display_name', 'avatar'/);
    expect(reset).not.toMatch(/storage\./);
    expect(reset).toMatch(/array_append\(v_changed/);
  });

  it("is idempotent: nothing to change returns null and writes no audit row", () => {
    expect(reset).toMatch(/cardinality\(v_changed\) = 0 then\s+return null/);
  });

  it("writes a snapshot, and Undo restores only what the person has not changed since", () => {
    expect(reset).toMatch(/write_audit\([\s\S]*'profile_reset'[\s\S]*v_snap/);
    const undo = fn("admin_undo_action");
    expect(undo).toMatch(/l\.action = 'profile_reset'/);
    expect(undo).toMatch(/pr\.display_name = v_placeholder/);
    expect(undo).toMatch(/pr\.avatar_path is null/);
    expect(undo).toMatch(/'profile_restore'/);
  });

  it("keeps every earlier Undo branch", () => {
    const undo = fn("admin_undo_action");
    for (const action of [
      "comment_hide",
      "comment_remove",
      "post_remove",
      "profile_reports_resolve",
      "post_reports_dismiss",
      "restrict",
      "suspend",
      "role_revoke",
    ]) {
      expect(undo).toContain(`'${action}'`);
    }
  });
});

describe("notes", () => {
  it("adding the same text again within a minute returns the first note", () => {
    expect(fn("admin_add_person_note")).toMatch(/interval '1 minute'/);
  });

  it("a moderator cannot read or write notes about a guest", () => {
    for (const name of ["admin_add_person_note", "admin_person_notes"]) {
      expect(fn(name)).toMatch(/v_guest and not public\.has_permission\(v_uid, 'people\.view_guests'\)/);
    }
  });
});

describe("grants", () => {
  it("every public function is revoked from anon and granted to signed-in users (helpers to nobody)", () => {
    const clientFns = [
      "touch_presence",
      "admin_people_search",
      "admin_person",
      "admin_people_stats",
      "admin_reveal_email",
      "admin_reset_profile_fields",
      "admin_undo_action",
      "admin_add_person_note",
      "admin_person_notes",
    ];
    for (const name of clientFns) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated`));
    }
    for (const name of ["device_fingerprint", "people_like_escape", "guest_has_activity"]) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated`),
      );
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${name}`));
    }
    for (const name of createdFunctions(sql)) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`));
    }
  });

  it("security definer functions pin their search path", () => {
    for (const name of createdFunctions(sql)) {
      expect(fn(name)).toMatch(/set search_path = public, pg_temp/);
    }
  });
});
