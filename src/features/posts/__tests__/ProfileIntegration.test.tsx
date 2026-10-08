import { cleanup, screen } from "@testing-library/react-native";

import { PublicProfileView } from "@/features/community/components/PublicProfileView";
import type { CommunityActions } from "@/features/community/queries";
import { parsePublicProfile } from "@/features/community/transport";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import i18n from "@/i18n";

import type { PostsTransport } from "../transport";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "me" }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: jest.fn(),
  messageDialog: jest.fn(),
}));

const PAYLOAD = {
  user_id: "author",
  username: "dilan.k",
  display_name: "Dilan Ahmed",
  avatar_path: null,
  is_private: false,
  roles: [],
  is_self: false,
  follow_status: "none",
  is_blocked: false,
  can_view_full: true,
  member_since: "2026-01-02T10:00:00Z",
  followers: 1,
  following: 1,
  comments: 0,
  helpful_received: 0,
  posts_count: 1,
  badges_hidden: false,
  milestones: null,
  recent_comments: [],
};

function actions(): CommunityActions {
  const noop = jest.fn(async () => undefined);
  return {
    follow: jest.fn(async () => "accepted" as const),
    unfollow: noop,
    undoUnfollow: noop,
    undoDecline: noop,
    accept: noop,
    decline: noop,
    block: noop,
    unblock: noop,
    report: noop,
  };
}

function fakePosts(): jest.Mocked<PostsTransport> {
  const at = Date.now() - 120_000;
  return {
    fetchPosts: jest.fn(async () => ({
      posts: [
        {
          id: "p1",
          userId: "author",
          body: "A post on the page",
          status: "visible" as const,
          createdAt: at,
          cursor: new Date(at).toISOString(),
        },
      ],
      nextCursor: null,
    })),
    createPost: jest.fn(),
    deletePost: jest.fn(),
    reportPost: jest.fn(),
    adminRemovePost: jest.fn(),
  } as unknown as jest.Mocked<PostsTransport>;
}

function profile(overrides: Record<string, unknown> = {}) {
  const parsed = parsePublicProfile({ ...PAYLOAD, ...overrides });
  if (!parsed) {
    throw new Error("fixture did not parse");
  }
  return parsed;
}

describe("Posts on the public profile page", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("puts the Posts section on a public profile, under the header that already names the author", async () => {
    const posts = fakePosts();
    await renderWithProviders(
      <PublicProfileView
        profile={profile()}
        actions={actions()}
        postsTransport={posts}
      />,
    );
    expect(await screen.findByText("A post on the page")).toBeTruthy();
    expect(screen.getByTestId("public-profile-name").props.children).toBe("Dilan Ahmed");
    expect(screen.getByTestId("posts-section")).toBeTruthy();
  });

  it("shows a private account's non-follower the gate and never fetches posts", async () => {
    const posts = fakePosts();
    await renderWithProviders(
      <PublicProfileView
        profile={profile({ is_private: true, can_view_full: false })}
        actions={actions()}
        postsTransport={posts}
      />,
    );
    expect(screen.getByText("Posts are visible to followers.")).toBeTruthy();
    expect(posts.fetchPosts).not.toHaveBeenCalled();
  });

  it("leaves the rest of the page intact when the posts feature is not on the server yet", async () => {
    const posts = fakePosts();
    posts.fetchPosts.mockRejectedValue(
      Object.assign(new Error("unavailable"), {
        name: "CommunityError",
        code: "unavailable",
      }),
    );
    await renderWithProviders(
      <PublicProfileView
        profile={profile()}
        actions={actions()}
        postsTransport={posts}
      />,
    );
    expect(screen.getByTestId("public-profile-name")).toBeTruthy();
    expect(screen.getByTestId("profile-counts")).toBeTruthy();
    expect(screen.queryByText("Couldn't do that. Try again.")).toBeNull();
  });
});
