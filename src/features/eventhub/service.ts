import type { EventHubTransport } from "./transport";
import type { HubAuthor, HubRole, HubThreadData } from "./types";

/**
 * One thread read: the comments (required), then the people and marks around
 * them. The side lookups are best effort: if profiles, roles or the helpful
 * marks cannot be read, the conversation still shows (authors fall back to
 * "Anonymous", no role marks), instead of the whole screen failing.
 */
export async function loadHubThread(
  transport: EventHubTransport,
  eventUuid: string,
  options: { isAccount: boolean },
): Promise<HubThreadData> {
  const comments = await transport.fetchComments(eventUuid);
  const userIds = [
    ...new Set(
      comments.map((comment) => comment.userId).filter((id): id is string => id !== null),
    ),
  ];
  const commentIds = comments.map((comment) => comment.id);

  const noAuthors: Record<string, HubAuthor> = {};
  const noRoles: Record<string, HubRole[]> = {};
  const [authors, roles, helpedIds] = await Promise.all([
    transport.fetchAuthors(userIds).catch(() => noAuthors),
    transport.fetchRoles(userIds).catch(() => noRoles),
    options.isAccount
      ? transport.fetchMyHelpful(commentIds).catch((): string[] => [])
      : Promise.resolve<string[]>([]),
  ]);

  return { comments, authors, roles, helpedIds };
}

/** True for the roles that may approve or hide comments. */
export function hasModeratorRole(roles: readonly HubRole[] | undefined): boolean {
  return (roles ?? []).some((r) => r.role === "official" || r.role === "moderator");
}
