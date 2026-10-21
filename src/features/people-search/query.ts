/**
 * What the people search sends: the typed name or @username, trimmed, without
 * the leading "@", in lower case. The server (`mention_suggestions`,
 * migration 0063) matches a username or display name from its start, needs 2
 * to 24 characters and answers with 8 people at most.
 */
export const PEOPLE_SEARCH_MIN = 2;
export const PEOPLE_SEARCH_MAX = 24;
/** The most people one search returns (the server's own limit). */
export const PEOPLE_SEARCH_LIMIT = 8;

/** The prefix to search for, or null when there is not enough to search. */
export function searchPrefix(text: string): string | null {
  const prefix = text.trim().replace(/^@+/, "").trim().toLowerCase();
  return prefix.length >= PEOPLE_SEARCH_MIN && prefix.length <= PEOPLE_SEARCH_MAX
    ? prefix
    : null;
}
