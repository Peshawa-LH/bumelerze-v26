/**
 * @mentions, the client's mirror of the server rule (migration 0063,
 * `mention_targets`): "@" followed by a username (the 0045 rules: letters
 * a–z, digits, dot and underscore, 3 to 24 characters), not preceded by a
 * letter, digit, dot, underscore or "@" (so an email address is not a
 * mention). A name that ends in a full stop is tried as written and without
 * the stop(s), because a sentence often ends right after a name. The server
 * decides who is actually mentioned and told; this file only finds the
 * candidates for links and for the composer's suggestions.
 */

/** At most this many people are mentioned (told) per text; further names
 * stay plain text on the server. */
export const MENTION_LIMIT = 5;

/** Characters a username may contain (0045, before lower-casing). */
const NAME = "[A-Za-z0-9_.]";
const MENTION_RE = new RegExp(`(^|[^A-Za-z0-9_.@])@(${NAME}{3,24})`, "g");
/** An "@" being typed at the caret, with what follows it so far. */
const TYPING_RE = new RegExp(`(^|[^A-Za-z0-9_.@])@(${NAME}{0,24})$`);

/** Characters typed after "@" before suggestions are asked for. */
export const SUGGEST_MIN_CHARS = 2;

export type MentionSegment =
  | { kind: "text"; text: string }
  | {
      kind: "mention";
      /** Exactly as written, "@" included, e.g. "@Shirin.". */
      raw: string;
      /** Lower case, as written (without "@"). */
      name: string;
      /** Lower case without trailing full stops (equal to `name` when there
       * are none). */
      trimmed: string;
    };

/** Splits a text into plain runs and @mention candidates, in order. */
export function splitMentions(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION_RE)) {
    const lead = match[1] ?? "";
    const word = match[2] ?? "";
    const at = (match.index ?? 0) + lead.length;
    if (at > last) {
      segments.push({ kind: "text", text: text.slice(last, at) });
    }
    const name = word.toLowerCase();
    segments.push({
      kind: "mention",
      raw: `@${word}`,
      name,
      trimmed: name.replace(/\.+$/, ""),
    });
    last = at + 1 + word.length;
  }
  if (last < text.length) {
    segments.push({ kind: "text", text: text.slice(last) });
  }
  return segments;
}

/** Every name worth asking the server about (both spellings of a name that
 * ends in a full stop), lower case, without repeats, in order. */
export function mentionCandidates(segments: readonly MentionSegment[]): string[] {
  const names: string[] = [];
  for (const segment of segments) {
    if (segment.kind !== "mention") continue;
    for (const name of [segment.name, segment.trimmed]) {
      if (name.length >= 3 && !names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

/** How a mention reads once we know which names exist: the part shown as a
 * link (or null: plain text) and what follows it as plain text. */
export function resolveMention(
  segment: Extract<MentionSegment, { kind: "mention" }>,
  known: ReadonlySet<string>,
): { username: string | null; linkText: string; rest: string } {
  if (known.has(segment.name)) {
    return { username: segment.name, linkText: segment.raw, rest: "" };
  }
  if (segment.trimmed !== segment.name && known.has(segment.trimmed)) {
    const linkText = segment.raw.slice(0, 1 + segment.trimmed.length);
    return {
      username: segment.trimmed,
      linkText,
      rest: segment.raw.slice(linkText.length),
    };
  }
  return { username: null, linkText: segment.raw, rest: "" };
}

/** The "@name" being typed just before the caret, or null. `start` is where
 * the "@" is. */
export function activeMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const match = TYPING_RE.exec(before);
  if (!match) {
    return null;
  }
  const query = match[2] ?? "";
  return { start: before.length - query.length - 1, query };
}

/** Puts "@username " in place of the "@…" being typed. Returns the new text
 * and where the caret goes. */
export function applyMention(
  text: string,
  active: { start: number; query: string },
  username: string,
): { text: string; caret: number } {
  const insert = `@${username} `;
  const end = active.start + 1 + active.query.length;
  const after = text.slice(end).replace(/^ /, "");
  return {
    text: text.slice(0, active.start) + insert + after,
    caret: active.start + insert.length,
  };
}
