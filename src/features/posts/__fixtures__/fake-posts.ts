import { parsePublicProfile } from "@/features/community/transport";
import type { PublicProfile } from "@/features/community/types";

import type { PostsTransport } from "../transport";
import type { PostsPage, ProfilePost } from "../types";

const MINUTE = 60_000;

/** A post as the server would return it; `minutesAgo` sets its time. */
export function post(
  id: string,
  minutesAgo: number,
  overrides: Partial<ProfilePost> = {},
): ProfilePost {
  const at = Date.now() - minutesAgo * MINUTE;
  return {
    id,
    userId: "author",
    body: `text of ${id}`,
    status: "visible",
    kind: "text",
    event: null,
    createdAt: at,
    editedAt: null,
    helpfulCount: 0,
    myHelpful: false,
    editLocked: false,
    cursor: new Date(at).toISOString(),
    commentCount: 0,
    commentsOff: false,
    ...overrides,
  };
}

/** A parsed `public_profile()` answer (the author "dilan.k"). */
export function profileOf(overrides: Record<string, unknown> = {}): PublicProfile {
  const parsed = parsePublicProfile({
    user_id: "author",
    username: "dilan.k",
    display_name: "Dilan",
    avatar_path: null,
    is_private: false,
    roles: [],
    is_self: false,
    follow_status: "none",
    is_blocked: false,
    can_view_full: true,
    member_since: "2026-01-01T00:00:00Z",
    followers: 0,
    following: 0,
    comments: 0,
    helpful_received: 0,
    posts_count: 3,
    badges_hidden: false,
    milestones: null,
    recent_comments: [],
    ...overrides,
  });
  if (!parsed) {
    throw new Error("fixture did not parse");
  }
  return parsed;
}

/** An in-memory server: pages of `pageSize`, newest first, with real create,
 * delete, edit, helpful and pin. */
export function makeFake(initial: ProfilePost[], pageSize = 2) {
  let store = [...initial];
  const pinned: { id: string | null } = { id: null };
  const fake = {
    pinned,
    fetchPosts: jest.fn(async ({ before, includeRemoved }) => {
      const rows = store
        .filter((p) => includeRemoved || p.status === "visible")
        .sort((a, b) => b.createdAt - a.createdAt)
        .filter((p) => (before ? p.cursor < before : true));
      const posts = rows.slice(0, pageSize);
      const last = posts[posts.length - 1];
      return {
        posts,
        nextCursor: rows.length > pageSize && last ? last.cursor : null,
      } satisfies PostsPage;
    }),
    fetchPost: jest.fn(async (_userId: string, id: string) => {
      return store.find((p) => p.id === id) ?? null;
    }),
    createPost: jest.fn(async (userId: string, body: string) => {
      store.push(post(`new-${store.length}`, 0, { userId, body }));
    }),
    editPost: jest.fn(async (id: string, body: string) => {
      store = store.map((p) => (p.id === id ? { ...p, body, editedAt: Date.now() } : p));
    }),
    setHelpful: jest.fn(async (id: string, helpful: boolean) => {
      let count = 0;
      store = store.map((p) => {
        if (p.id !== id) return p;
        count = p.helpfulCount + (helpful === p.myHelpful ? 0 : helpful ? 1 : -1);
        return { ...p, myHelpful: helpful, helpfulCount: count };
      });
      return { helpful, count };
    }),
    setPinned: jest.fn(async (id: string | null) => {
      pinned.id = id;
    }),
    shareEvent: jest.fn(async () => "shared-post"),
    deletePost: jest.fn(async (id: string) => {
      store = store.filter((p) => p.id !== id);
    }),
    restorePost: jest.fn(async () => undefined),
    reportPost: jest.fn(async () => undefined),
    adminRemovePost: jest.fn(async () => undefined),
    adminRestorePost: jest.fn(async () => undefined),
  };
  return fake as unknown as jest.Mocked<PostsTransport> & {
    pinned: { id: string | null };
  };
}
