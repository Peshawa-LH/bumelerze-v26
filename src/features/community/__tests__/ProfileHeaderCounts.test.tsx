import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import { makeFake, post, profileOf } from "@/features/posts/__fixtures__/fake-posts";
import { makeSocialTransport } from "@/features/social/__fixtures__/testing";
import type { ProfileHeaderInfo } from "@/features/social/transport";
import i18n from "@/i18n";

import { PublicProfileView } from "../components/PublicProfileView";
import type { ProfileReportReason } from "../constants";
import type { CommunityActions } from "../queries";

/**
 * The profile header of review note 5.1 (mockups 3c and 3d) against the
 * server's profile_header() (migration 0065): posts, followers and following
 * also for a private account, "Followed by ..." for trust, and the calm lock
 * in place of a private account's posts.
 */

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
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

const HEADER: ProfileHeaderInfo = {
  posts: 6,
  followers: 88,
  following: 140,
  followedBy: [
    { username: "dilan.k", displayName: "Dilan" },
    { username: "shno.m", displayName: "Shno" },
  ],
  followedByTotal: 2,
};

function actions(): CommunityActions {
  const done = jest.fn(async () => undefined);
  return {
    follow: jest.fn(async () => "pending" as const),
    unfollow: done,
    undoUnfollow: done,
    undoDecline: done,
    accept: done,
    decline: done,
    block: done,
    unblock: done,
    report: jest.fn<Promise<void>, [string, ProfileReportReason]>(async () => undefined),
  } as unknown as CommunityActions;
}

const plain = (text: string) => text.replace(/[⁦-⁩]/g, "");

describe("profile header counts (0065)", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows the server's posts, followers and following, and 'Followed by' two people", async () => {
    const social = makeSocialTransport({ header: HEADER });
    await renderWithProviders(
      <PublicProfileView
        profile={profileOf({ username: "aram.h", display_name: "Aram Hassan" })}
        actions={actions()}
        postsTransport={makeFake([post("p", 5)])}
        socialTransport={social}
      />,
    );
    await waitFor(() =>
      expect(
        plain(String(screen.getByTestId("count-followers").props.accessibilityLabel)),
      ).toMatch(/88/),
    );
    expect(social.fetchProfileHeader).toHaveBeenCalledWith("aram.h");
    expect(
      plain(String(screen.getByTestId("count-posts").props.accessibilityLabel)),
    ).toMatch(/6/);
    expect(screen.getByTestId("public-profile-followed-by")).toHaveTextContent(
      "Followed by dilan.k and shno.m",
    );
  });

  it("says how many more follow when there are more than two", async () => {
    const social = makeSocialTransport({ header: { ...HEADER, followedByTotal: 5 } });
    await renderWithProviders(
      <PublicProfileView
        profile={profileOf({ username: "aram.h" })}
        actions={actions()}
        postsTransport={makeFake([])}
        socialTransport={social}
      />,
    );
    expect(await screen.findByTestId("public-profile-followed-by")).toHaveTextContent(
      "Followed by dilan.k, shno.m and 3 more",
    );
  });

  it("a private account keeps its header and counts; the posts sit behind a calm lock; Request asks to follow", async () => {
    const social = makeSocialTransport({
      header: { ...HEADER, followedBy: [], followedByTotal: 0 },
    });
    const posts = makeFake([post("secret", 5)]);
    const community = actions();
    await renderWithProviders(
      <PublicProfileView
        profile={profileOf({
          username: "shno.m",
          display_name: "Shno Mahmud",
          is_private: true,
          can_view_full: false,
        })}
        actions={community}
        postsTransport={posts}
        socialTransport={social}
      />,
    );
    await waitFor(() =>
      expect(
        plain(String(screen.getByTestId("count-following").props.accessibilityLabel)),
      ).toMatch(/140/),
    );
    // Counts only: the lists stay closed to a non-follower.
    expect(screen.getByTestId("count-followers").props.accessibilityRole).toBeUndefined();
    expect(screen.getByTestId("posts-gate")).toBeTruthy();
    expect(screen.queryByTestId("profile-tabs")).toBeNull();
    expect(screen.queryByTestId("public-profile-followed-by")).toBeNull();
    expect(posts.fetchPosts).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText(/Request: Shno Mahmud/));
    await waitFor(() => expect(community.follow).toHaveBeenCalled());
  });
});
