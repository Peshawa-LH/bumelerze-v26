import { readdirSync } from "fs";

import { functionSource, readCode } from "../sql-test-utils";

/**
 * The guard for "Delete my account" (review S4). Every column that points at a
 * user (a foreign key to auth.users) must be listed here with what happens to
 * it when the person deletes their account. A new table with such a column
 * fails this test until somebody decides, so it cannot be forgotten.
 *
 *   cascade  the row goes with the user (foreign key on delete cascade)
 *   erase    the row is deleted or blanked by delete_my_account() itself
 *   unlink   the row stays with the column set to null (foreign key on delete
 *            set null), on purpose, for the reason given
 *
 * "erase" entries must also be visible in the body of delete_my_account(), so
 * the function cannot drift away from this list.
 */
type Handling = "cascade" | "erase" | "unlink";

interface Entry {
  onDelete: "cascade" | "set null";
  handling: Handling;
  /** A snippet that must appear in delete_my_account() (erase and unlink-by-update only). */
  inFunction?: string;
  why: string;
}

const MANIFEST: Record<string, Entry> = {
  // research data and the inbox
  "felt_reports.user_id": {
    onDelete: "set null",
    handling: "unlink",
    inFunction: "update public.felt_reports set user_id = null",
    why: "research consent: reports are used without the name; the row stays",
  },
  "felt_comments.user_id": {
    onDelete: "set null",
    handling: "erase",
    inFunction: "delete from public.felt_comments",
    why: "free text, public once approved: deleted with the account",
  },
  "feedback.user_id": {
    onDelete: "set null",
    handling: "unlink",
    inFunction: "update public.feedback set user_id = null, contact = null",
    why: "the message stays for the inbox, unlinked, without the contact",
  },
  // profile
  "profiles.user_id": { onDelete: "cascade", handling: "erase", inFunction: "delete from public.profiles", why: "the public profile" },
  "profile_private.user_id": { onDelete: "cascade", handling: "erase", inFunction: "delete from public.profile_private", why: "profession and consents" },
  "user_roles.user_id": { onDelete: "cascade", handling: "erase", inFunction: "delete from public.user_roles", why: "ranks" },
  "user_roles.granted_by": { onDelete: "set null", handling: "unlink", why: "the admin who granted it; audit" },
  "private_ranks.user_id": { onDelete: "cascade", handling: "cascade", why: "the private admin rank (0060)" },
  "private_ranks.granted_by": { onDelete: "set null", handling: "unlink", why: "who granted it" },
  "notification_subscriptions.user_id": { onDelete: "cascade", handling: "erase", inFunction: "delete from public.notification_subscriptions", why: "push token and alert places" },
  "guidelines_acceptance.user_id": { onDelete: "cascade", handling: "cascade", why: "the acceptance record" },
  "app_presence.user_id": { onDelete: "cascade", handling: "cascade", why: "last seen, platform, version" },
  // comments
  "event_comments.user_id": {
    onDelete: "set null",
    handling: "erase",
    inFunction: "update public.event_comments c",
    why: "blanked (text and area wiped), the row stays as a placeholder",
  },
  "comment_reactions.user_id": { onDelete: "cascade", handling: "erase", inFunction: "delete from public.comment_reactions", why: "helpful marks" },
  "comment_flags.user_id": { onDelete: "cascade", handling: "erase", inFunction: "delete from public.comment_flags", why: "reports the person made" },
  // posts and reports
  "profile_posts.user_id": { onDelete: "cascade", handling: "cascade", why: "their posts" },
  "profile_posts.removed_by": { onDelete: "set null", handling: "unlink", why: "the admin who removed it" },
  "post_reports.reporter_id": { onDelete: "cascade", handling: "cascade", why: "reports the person made" },
  // profile P2 (0058)
  "post_helpful.user_id": { onDelete: "cascade", handling: "cascade", why: "Helpful marks the person gave (marks on their posts go with the posts)" },
  "profile_name_changes.user_id": { onDelete: "cascade", handling: "cascade", why: "name change history (limits, admins); also purged after 90 days" },
  "profile_reports.reporter_id": { onDelete: "cascade", handling: "cascade", why: "reports the person made" },
  "profile_reports.reported_id": { onDelete: "cascade", handling: "cascade", why: "reports about the person" },
  // people graph
  "follows.follower_id": { onDelete: "cascade", handling: "cascade", why: "follows" },
  "follows.followee_id": { onDelete: "cascade", handling: "cascade", why: "follows" },
  "follow_undo.follower_id": { onDelete: "cascade", handling: "cascade", why: "one-minute undo memory" },
  "follow_undo.followee_id": { onDelete: "cascade", handling: "cascade", why: "one-minute undo memory" },
  "blocks.blocker_id": { onDelete: "cascade", handling: "cascade", why: "blocks" },
  "blocks.blocked_id": { onDelete: "cascade", handling: "cascade", why: "blocks" },
  // homes
  "home_tags.owner_user_id": {
    onDelete: "set null",
    handling: "erase",
    inFunction: "delete from public.home_tags where tag_id = any (v_tags)",
    why: "homes the person owns are deleted (coordinates, answers, photo rows, members)",
  },
  "home_members.user_id": { onDelete: "cascade", handling: "cascade", why: "memberships" },
  "home_join_attempts.user_id": { onDelete: "cascade", handling: "cascade", why: "join rate limit" },
  "home_surveys.user_id": { onDelete: "set null", handling: "unlink", why: "an answer given in somebody else's home stays with that home, unlinked" },
  "home_photos.user_id": { onDelete: "set null", handling: "unlink", why: "a photo added to somebody else's home stays with that home, unlinked" },
  "home_member_undo.user_id": { onDelete: "cascade", handling: "cascade", why: "10-minute memory of a removed member, for the owner's Undo" },
  "home_member_undo.removed_by": { onDelete: "cascade", handling: "cascade", why: "the owner's own undo memory" },
  // I'm safe (0057)
  "safety_checkins.user_id": { onDelete: "cascade", handling: "cascade", why: "the person's check-ins (no location); also purged after 30 days" },
  // moderation and audit
  "moderation_log.actor_id": { onDelete: "set null", handling: "unlink", why: "audit rows stay, unlinked" },
  "moderation_log.target_user_id": { onDelete: "set null", handling: "unlink", why: "audit rows stay, unlinked" },
  "moderation_evidence.author_id": {
    onDelete: "set null",
    handling: "erase",
    inFunction: "delete from public.moderation_evidence where author_id = v_uid",
    why: "purged now unless a restriction or appeal is active, then kept to its own expiry",
  },
  "account_restrictions.user_id": { onDelete: "cascade", handling: "cascade", why: "restrictions on the person" },
  "account_restrictions.created_by": { onDelete: "set null", handling: "unlink", why: "the admin who acted" },
  "account_restrictions.lifted_by": { onDelete: "set null", handling: "unlink", why: "the admin who lifted" },
  "admin_person_notes.user_id": { onDelete: "cascade", handling: "cascade", why: "admin notes about the person" },
  "admin_person_notes.author_id": { onDelete: "set null", handling: "unlink", why: "the admin who wrote it" },
};

interface Found {
  key: string;
  onDelete: string | null;
}

/** Splits a create-table body at its top-level commas. */
function topLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map((item) => item.trim()).filter(Boolean);
}

const REFERENCE = /references\s+auth\.users\s*\(\s*id\s*\)(?:\s+on\s+delete\s+(cascade|set null|restrict))?/i;

/** Every column that references auth.users in any migration. */
function foreignKeysToUsers(): Found[] {
  const files = readdirSync(`${__dirname}/..`)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();
  const found: Found[] = [];
  for (const file of files) {
    const code = readCode(file);
    for (const match of code.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(/gi)) {
      const table = match[1] as string;
      let depth = 1;
      let i = (match.index ?? 0) + match[0].length;
      const start = i;
      while (i < code.length && depth > 0) {
        if (code[i] === "(") depth += 1;
        if (code[i] === ")") depth -= 1;
        i += 1;
      }
      for (const item of topLevelItems(code.slice(start, i - 1))) {
        const ref = item.match(REFERENCE);
        if (!ref) continue;
        const column = item.match(/^(\w+)\s+uuid\b/i)?.[1];
        const tableLevel = item.match(/^foreign key\s*\(\s*(\w+)\s*\)/i)?.[1];
        const name = column ?? tableLevel;
        if (name) {
          found.push({ key: `${table}.${name}`, onDelete: ref[1]?.toLowerCase() ?? null });
        }
      }
    }
    for (const m of code.matchAll(
      /alter table public\.(\w+)\s+add column (?:if not exists )?(\w+)\s+uuid\b([^;]*);/gi,
    )) {
      const ref = (m[3] as string).match(REFERENCE);
      if (ref) {
        found.push({ key: `${m[1]}.${m[2]}`, onDelete: ref[1]?.toLowerCase() ?? null });
      }
    }
  }
  return found;
}

/** Columns that look like a person but have no foreign key (so no cascade). */
function unreferencedPersonColumns(): string[] {
  const files = readdirSync(`${__dirname}/..`)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();
  const out: string[] = [];
  const person = /^(user_id|owner_user_id|author_id|actor_id|target_user_id|reporter_id|reported_id|follower_id|followee_id|blocker_id|blocked_id|created_by|lifted_by|granted_by|removed_by)\s+uuid\b/i;
  for (const file of files) {
    const code = readCode(file);
    for (const match of code.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(/gi)) {
      const table = match[1] as string;
      let depth = 1;
      let i = (match.index ?? 0) + match[0].length;
      const start = i;
      while (i < code.length && depth > 0) {
        if (code[i] === "(") depth += 1;
        if (code[i] === ")") depth -= 1;
        i += 1;
      }
      for (const item of topLevelItems(code.slice(start, i - 1))) {
        const column = item.match(person)?.[1];
        if (column && !/references\s+/i.test(item)) {
          out.push(`${table}.${column}`);
        }
      }
    }
  }
  return out;
}

const found = foreignKeysToUsers();
const foundKeys = [...new Set(found.map((f) => f.key))].sort();
const deleteSource = functionSource(
  readCode("0056_social_p1_deletion_reports_guidelines.sql"),
  "delete_my_account",
);

describe("every column that points at a user is accounted for when the account is deleted", () => {
  it("finds the tables (the parser is not silently empty)", () => {
    expect(foundKeys.length).toBeGreaterThan(30);
    expect(foundKeys).toContain("event_comments.user_id");
    expect(foundKeys).toContain("moderation_evidence.author_id");
    expect(foundKeys).toContain("guidelines_acceptance.user_id");
  });

  it("has a decision for every foreign key to auth.users (a new table must be added to the list)", () => {
    const missing = foundKeys.filter((key) => !(key in MANIFEST));
    expect(missing).toEqual([]);
  });

  it("has no stale entries for columns that no longer exist", () => {
    const stale = Object.keys(MANIFEST).filter((key) => !foundKeys.includes(key));
    expect(stale).toEqual([]);
  });

  it("states the foreign key action the decision relies on", () => {
    for (const { key, onDelete } of found) {
      const entry = MANIFEST[key];
      if (entry) {
        expect([key, onDelete]).toEqual([key, entry.onDelete]);
      }
    }
  });

  it("every 'erase' decision, and every unlink done by hand, is in the body of delete_my_account()", () => {
    for (const [key, entry] of Object.entries(MANIFEST)) {
      if (entry.inFunction) {
        expect([key, deleteSource]).toEqual([key, expect.stringContaining(entry.inFunction)]);
      }
      if (entry.handling === "erase") {
        expect([key, entry.inFunction !== undefined]).toEqual([key, true]);
      }
    }
  });

  it("no person-looking column lacks a foreign key (it would never be cleaned up)", () => {
    // user_id columns that are deliberately not foreign keys are listed here.
    const allowed: string[] = [];
    expect(unreferencedPersonColumns().filter((c) => !allowed.includes(c))).toEqual([]);
  });

  it("every decision says why", () => {
    for (const entry of Object.values(MANIFEST)) {
      expect(entry.why.length).toBeGreaterThan(3);
    }
  });
});
