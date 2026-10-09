import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";
import { CommunityError } from "@/features/community/types";
import type { PostsTransport } from "@/features/posts/transport";
import i18n from "@/i18n";

import { AdminContent } from "../components/AdminContent";
import type { AdminTransport } from "../transport";
import type { ReportedPost } from "../types";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "admin-1" }),
}));
const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: jest.fn(),
}));

const mockHub = makeTransport({ permissions: [] });

const REPORTED: ReportedPost = {
  postId: "p1",
  authorId: "u1",
  username: "dilan.k",
  displayName: "Dilan",
  body: "buy cheap stuff now",
  reportCount: 3,
  lastReason: "spam",
  lastNote: null,
  status: "visible",
};

function adminTransport(rows: ReportedPost[] | Error): jest.Mocked<AdminTransport> {
  return {
    fetchQueue: jest.fn(async () => []),
    fetchRoleHolders: jest.fn(async () => []),
    fetchReportedProfiles: jest.fn(async () => []),
    grantRole: jest.fn(async () => undefined),
    revokeRole: jest.fn(async () => undefined),
    resolveProfileReports: jest.fn(async () => undefined),
    fetchReportedPosts: jest.fn(async () => {
      if (rows instanceof Error) {
        throw rows;
      }
      return rows;
    }),
    dismissPostReports: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<AdminTransport>;
}

function postsTransport(): jest.Mocked<PostsTransport> {
  return {
    fetchPosts: jest.fn(),
    createPost: jest.fn(),
    deletePost: jest.fn(),
    reportPost: jest.fn(),
    adminRemovePost: jest.fn(async () => undefined),
    adminRestorePost: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<PostsTransport>;
}

async function renderAdmin(
  permissions: Permission[],
  transport: AdminTransport,
  posts = postsTransport(),
) {
  mockHub.fetchMyPermissions.mockResolvedValue(permissions);
  await renderWithProviders(
    <AdminContent transport={transport} hubTransport={mockHub} postsTransport={posts} />,
  );
  return posts;
}

describe("reported posts in the admin screen", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockConfirm.mockClear();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("lists a reported post with its author, report count, reason and text", async () => {
    await renderAdmin(["comments.moderate", "posts.delete"], adminTransport([REPORTED]));
    expect(await screen.findByTestId("admin-posts")).toBeTruthy();
    expect(screen.getByText("buy cheap stuff now")).toBeTruthy();
    expect(screen.getByText("Dilan")).toBeTruthy();
    expect(screen.getByText("Reports: 3 · Spam or advertising")).toBeTruthy();
    expect(screen.getByText("Reported posts")).toBeTruthy();
    expect(screen.queryByTestId("reported-post-note-p1")).toBeNull();
  });

  it("shows the reporter's note under the reason, and renames the earlier reason words", async () => {
    await renderAdmin(
      ["comments.moderate"],
      adminTransport([
        { ...REPORTED, lastReason: "false", lastNote: "says a bigger one comes" },
      ]),
    );
    expect(
      await screen.findByText("Reports: 3 · Fake earthquake prediction or rumour"),
    ).toBeTruthy();
    expect(screen.getByTestId("reported-post-note-p1")).toHaveTextContent(
      "\u201Csays a bigger one comes\u201D",
    );
  });

  it("tapping the author's name opens their profile", async () => {
    await renderAdmin(["comments.moderate"], adminTransport([REPORTED]));
    const link = await screen.findByTestId("reported-post-name-p1");
    expect(link.props.accessibilityRole).toBe("link");
    expect(link.props.accessibilityLabel).toBe("Open profile of Dilan");
    await fireEvent.press(link);
    expect(mockPush).toHaveBeenCalledWith("/u/dilan.k");
  });

  it("Open goes to the author's profile", async () => {
    await renderAdmin(["comments.moderate"], adminTransport([REPORTED]));
    await fireEvent.press(await screen.findByTestId("reported-post-open-p1"));
    expect(mockPush).toHaveBeenCalledWith("/u/dilan.k");
  });

  it("Remove asks for a reason and a confirmation, then removes the post", async () => {
    const posts = await renderAdmin(
      ["comments.moderate", "posts.delete"],
      adminTransport([REPORTED]),
    );
    await fireEvent.press(await screen.findByTestId("reported-post-remove-p1"));
    await fireEvent.press(screen.getByTestId("remove-reason-spam"));
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(posts.adminRemovePost).not.toHaveBeenCalled();
    await act(async () => {
      (mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void }).onConfirm();
    });
    await waitFor(() => expect(posts.adminRemovePost).toHaveBeenCalledWith("p1", "spam"));
  });

  it("offers Undo for 10 s after Remove, and Undo restores the post", async () => {
    const posts = await renderAdmin(
      ["comments.moderate", "posts.delete"],
      adminTransport([REPORTED]),
    );
    await fireEvent.press(await screen.findByTestId("reported-post-remove-p1"));
    await fireEvent.press(screen.getByTestId("remove-reason-spam"));
    await act(async () => {
      (mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void }).onConfirm();
    });
    await waitFor(() => expect(posts.adminRemovePost).toHaveBeenCalledWith("p1", "spam"));
    expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
      "Post removed",
    );
    expect(posts.adminRestorePost).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("snackbar-action"));
    await waitFor(() => expect(posts.adminRestorePost).toHaveBeenCalledWith("p1"));
  });

  it("Dismiss closes the reports without removing", async () => {
    const transport = adminTransport([REPORTED]);
    const posts = await renderAdmin(["comments.moderate", "posts.delete"], transport);
    await fireEvent.press(await screen.findByTestId("reported-post-dismiss-p1"));
    await waitFor(() => expect(transport.dismissPostReports).toHaveBeenCalledWith("p1"));
    expect(posts.adminRemovePost).not.toHaveBeenCalled();
  });

  it("shows a moderator the reports with Open and Dismiss but no Remove", async () => {
    await renderAdmin(["comments.moderate"], adminTransport([REPORTED]));
    await screen.findByTestId("reported-post-p1");
    expect(screen.getByTestId("reported-post-dismiss-p1")).toBeTruthy();
    expect(screen.queryByTestId("reported-post-remove-p1")).toBeNull();
  });

  it("shows nothing to an ordinary account and never asks the server", async () => {
    const transport = adminTransport([REPORTED]);
    await renderAdmin([], transport);
    await screen.findByTestId("admin-no-access");
    expect(screen.queryByTestId("admin-posts")).toBeNull();
    expect(transport.fetchReportedPosts).not.toHaveBeenCalled();
  });

  it("hides the section when nothing is reported", async () => {
    const transport = adminTransport([]);
    await renderAdmin(["comments.moderate"], transport);
    await screen.findByTestId("admin-queue");
    await waitFor(() => expect(transport.fetchReportedPosts).toHaveBeenCalled());
    expect(screen.queryByTestId("admin-posts")).toBeNull();
  });

  it("hides the section, without an error, when the migration is missing", async () => {
    const missing = adminTransport(new CommunityError("unavailable"));
    await renderAdmin(["comments.moderate"], missing);
    await screen.findByTestId("admin-queue");
    await waitFor(() => expect(missing.fetchReportedPosts).toHaveBeenCalled());
    expect(screen.queryByTestId("admin-posts")).toBeNull();
  });
});
