import type { PostCommentsTransport } from "../transport";
import type { PostComment } from "../types";

const MINUTE = 60_000;

/** A comment as `post_comments_page()` returns it; `minutesAgo` sets its time. */
export function comment(
  id: string,
  minutesAgo: number,
  overrides: Partial<PostComment> = {},
): PostComment {
  return {
    id,
    postId: "p1",
    parentId: null,
    userId: `u-${id}`,
    username: `user_${id}`,
    displayName: `Name ${id}`,
    avatarPath: null,
    roles: [],
    body: `text of ${id}`,
    status: "visible",
    createdAt: Date.now() - minutesAgo * MINUTE,
    ...overrides,
  };
}

/** An in-memory server for one post's comments. */
export function makeFakeComments(initial: PostComment[]) {
  let store = [...initial];
  const fake = {
    fetchComments: jest.fn(async () =>
      store.filter((c) => c.status !== ("hidden" as string)),
    ),
    addComment: jest.fn(
      async (input: {
        postId: string;
        body: string;
        parentId: string | null;
        clientId: string;
      }) => {
        store.push(
          comment(input.clientId, 0, {
            postId: input.postId,
            parentId: input.parentId,
            userId: "me",
            username: "me_user",
            displayName: "Me",
            body: input.body,
          }),
        );
        return { id: input.clientId, status: "visible" as const };
      },
    ),
    deleteComment: jest.fn(async (id: string) => {
      const target = store.find((c) => c.id === id);
      store = store.filter((c) => c.id !== id);
      return target?.userId === "me" ? ("author" as const) : ("owner" as const);
    }),
    restoreComment: jest.fn(async () => undefined),
    setCommentsOff: jest.fn(async () => undefined),
    reportComment: jest.fn(async () => undefined),
    moderate: jest.fn(async () => undefined),
    adminRemove: jest.fn(async () => undefined),
    adminRestore: jest.fn(async () => undefined),
    fetchQueue: jest.fn(async () => []),
  };
  return fake as unknown as jest.Mocked<PostCommentsTransport>;
}
