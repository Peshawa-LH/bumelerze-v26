import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { AdminContent } from "@/features/admin/components/AdminContent";
import type { AdminTransport } from "@/features/admin/transport";
import type { QueueComment, ReportedPost } from "@/features/admin/types";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";
import { PostsSection } from "@/features/posts/components/PostsSection";
import { makeFake, post, profileOf } from "@/features/posts/__fixtures__/fake-posts";
import i18n from "@/i18n";

import { makeFilterTransport } from "../__fixtures__/fake-filter";

/**
 * Held content (migration 0059): the author sees a held post as "Waiting for
 * review" with no Edit or Pin; moderators see why a comment or post waits
 * (the matched word and its kind, or busy-time review) and approve a held
 * post; the official reaches the Word filter screen from Admin.
 */

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "me" }),
}));
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: jest.fn(),
  messageDialog: jest.fn(),
}));

const HELD_POST: ReportedPost = {
  postId: "p-held",
  authorId: "u1",
  username: "newbie",
  displayName: "Newbie",
  body: "Big earthquake tomorrow at 3am",
  reportCount: 0,
  lastReason: null,
  lastNote: null,
  status: "pending",
};
const HELD_COMMENT: QueueComment = {
  id: "c-held",
  eventId: "e1",
  hubId: "bml2026aa",
  authorId: "u2",
  authorName: "Aso",
  body: "quake tonight!!",
  status: "pending",
  flagCount: 0,
  lastReason: null,
  lastNote: null,
  createdAt: Date.now(),
};

function adminTransport(): jest.Mocked<AdminTransport> {
  return {
    fetchQueue: jest.fn(async () => [HELD_COMMENT]),
    fetchRoleHolders: jest.fn(async () => []),
    fetchReportedProfiles: jest.fn(async () => []),
    fetchReportedPosts: jest.fn(async () => [HELD_POST]),
    dismissPostReports: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<AdminTransport>;
}

async function renderAdmin(permissions: Permission[], filter = makeFilterTransport()) {
  const hub = makeTransport({ permissions });
  const transport = adminTransport();
  await renderWithProviders(
    <AdminContent transport={transport} hubTransport={hub} filterTransport={filter} />,
  );
  return { filter, transport };
}

describe("held content", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("shows the author their held post as waiting, without Edit, Pin or Helpful", async () => {
    await renderWithProviders(
      <PostsSection
        profile={profileOf({ is_self: true, user_id: "me" })}
        transport={makeFake([post("held", 2, { userId: "me", status: "pending" })])}
        hubTransport={makeTransport()}
      />,
    );
    expect(await screen.findByTestId("post-pending-held")).toBeTruthy();
    expect(
      screen.getByText(
        "Waiting for review. Only you can see this post until a moderator approves it.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("post-edit-held")).toBeNull();
    expect(screen.queryByTestId("post-pin-held")).toBeNull();
    expect(screen.getByTestId("post-delete-held")).toBeTruthy();
  });

  it("tells moderators which word held a comment, and its kind", async () => {
    const filter = makeFilterTransport({
      holds: [
        {
          targetId: "c-held",
          reason: "filter",
          term: "quake tonight",
          kind: "prediction",
        },
      ],
    });
    await renderAdmin(["comments.moderate"], filter);
    expect(
      await screen.findByText("Word filter: “quake tonight” · Prediction or rumour"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(filter.fetchHolds).toHaveBeenCalledWith("comment", ["c-held"]),
    );
  });

  it("lists a held post under 'Posts to review' with Approve and no Dismiss", async () => {
    const filter = makeFilterTransport({
      holds: [{ targetId: "p-held", reason: "surge", term: null, kind: null }],
    });
    await renderAdmin(["comments.moderate"], filter);
    expect(await screen.findByText("Posts to review")).toBeTruthy();
    expect(screen.getByTestId("reported-post-meta-p-held").props.children).toBe(
      "Waiting for review",
    );
    expect(await screen.findByText("Busy time: new account")).toBeTruthy();
    expect(screen.queryByTestId("reported-post-dismiss-p-held")).toBeNull();
    await fireEvent.press(screen.getByTestId("reported-post-approve-p-held"));
    await waitFor(() => expect(filter.approvePost).toHaveBeenCalledWith("p-held"));
  });

  it("offers the Word filter screen with filter.manage", async () => {
    await renderAdmin(["comments.moderate", "filter.manage"]);
    await fireEvent.press(await screen.findByTestId("admin-filter-row"));
    expect(mockPush).toHaveBeenCalledWith("/admin/filter");
  });

  it("does not offer it without filter.manage", async () => {
    await renderAdmin(["comments.moderate"]);
    await screen.findByTestId("admin-queue");
    expect(screen.queryByTestId("admin-filter-row")).toBeNull();
  });

  it("words the hold in Arabic too", async () => {
    await i18n.changeLanguage("ar");
    const filter = makeFilterTransport({
      holds: [{ targetId: "c-held", reason: "filter", term: "kys", kind: "abuse" }],
    });
    await renderAdmin(["comments.moderate"], filter);
    const note = await screen.findByTestId("queue-hold-c-held");
    expect(note.props.children).toBe(
      i18n.t("contentFilter.hold.filter", {
        term: "kys",
        kind: i18n.t("contentFilter.kinds.abuse"),
      }),
    );
  });
});
