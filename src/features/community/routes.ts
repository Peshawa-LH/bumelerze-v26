/** Route of a public profile page. Kept import-free so any feature can link
 * to a profile without depending on the community feature. */
export function profileHref(username: string): `/u/${string}` {
  return `/u/${encodeURIComponent(username)}`;
}

/** Route of a profile's followers / following list. */
export function peopleHref(
  username: string,
  kind: "followers" | "following",
): `/u/${string}/people?kind=${"followers" | "following"}` {
  return `/u/${encodeURIComponent(username)}/people?kind=${kind}`;
}
