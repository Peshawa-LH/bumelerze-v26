import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { CommunityError } from "@/features/community/types";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import { HubError } from "@/features/eventhub/types";
import type { PostsTransport } from "@/features/posts/transport";
import type { UndoTransport } from "@/features/undo/transport";
import type { RecentlyDeletedItem } from "@/features/undo/types";
import i18n from "@/i18n";

import { RecentlyDeletedSection } from "../components/RecentlyDeletedSection";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
let mockUserId: string | null = "me";
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({
    status: mockUserId ? "account" : "none",
    userId: mockUserId,
  }),
}));

const HOUR = 3_600_000;

function item(overrides: Partial<RecentlyDeletedItem> = {}): RecentlyDeletedItem {
  const now = Date.now();
  return {
    kind: "comment",
    id: "c1",
    body: "I felt it strongly",
    deletedAt: now - 2 * HOUR,
    expiresAt: now + 22 * HOUR,
    hubId: "bml202610aa",
    place: "Duhok",
    magnitude: 4.2,
    ...overrides,
  };
}

function undoTransport(rows: RecentlyDeletedItem[] | Error): jest.Mocked<UndoTransport> {
  return {
    fetchRecentlyDeleted: jest.fn(async () => {
      if (rows instanceof Error) {
        throw rows;
      }
      return rows;
    }),
  };
}

function posts(): jest.Mocked<PostsTransport> {
  return {
    restorePost: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<PostsTransport>;
}

async function renderSection(
  transport: UndoTransport,
  hub = makeTransport(),
  postsTransport = posts(),
) {
  await renderWithProviders(
    <RecentlyDeletedSection
      transport={transport}
      hubTransport={hub}
      postsTransport={postsTransport}
    />,
  );
  return { hub, postsTransport };
}

describe("RecentlyDeletedSection (Profile, owner only)", () => {
  beforeEach(async () => {
    mockUserId = "me";
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("renders nothing when there is nothing to restore", async () => {
    const transport = undoTransport([]);
    await renderSection(transport);
    await waitFor(() => expect(transport.fetchRecentlyDeleted).toHaveBeenCalled());
    expect(screen.queryByTestId("recently-deleted")).toBeNull();
  });

  it("renders nothing before the migration is applied or when the list fails", async () => {
    await renderSection(undoTransport(new CommunityError("unavailable")));
    expect(screen.queryByTestId("recently-deleted")).toBeNull();
  });

  it("reads nothing for a install that is not signed in", async () => {
    mockUserId = null;
    const transport = undoTransport([item()]);
    await renderSection(transport);
    expect(transport.fetchRecentlyDeleted).not.toHaveBeenCalled();
    expect(screen.queryByTestId("recently-deleted")).toBeNull();
  });

  it("lists deleted comments and posts with their text and the 24-hour hint", async () => {
    await renderSection(
      undoTransport([
        item(),
        item({
          kind: "post",
          id: "p1",
          body: "My deleted post",
          hubId: null,
          place: null,
        }),
      ]),
    );
    expect(await screen.findByText("Recently deleted")).toBeTruthy();
    expect(screen.getByText("You can bring these back for 24 hours.")).toBeTruthy();
    expect(screen.getByText("Comment · Duhok")).toBeTruthy();
    expect(screen.getByText("I felt it strongly")).toBeTruthy();
    expect(screen.getByText("Post")).toBeTruthy();
    expect(screen.getByText("My deleted post")).toBeTruthy();
  });

  it("restores a comment through the hub transport and says so", async () => {
    const { hub, postsTransport } = await renderSection(undoTransport([item()]));
    await fireEvent.press(await screen.findByTestId("restore-comment-c1"));
    await waitFor(() => expect(hub.restoreComment).toHaveBeenCalledWith("c1"));
    expect(postsTransport.restorePost).not.toHaveBeenCalled();
    expect(await screen.findByTestId("snackbar-message")).toHaveTextContent("Restored");
  });

  it("restores a post through the posts transport", async () => {
    const { hub, postsTransport } = await renderSection(
      undoTransport([item({ kind: "post", id: "p1", body: "Post text", place: null })]),
    );
    await fireEvent.press(await screen.findByTestId("restore-post-p1"));
    await waitFor(() => expect(postsTransport.restorePost).toHaveBeenCalledWith("p1"));
    expect(hub.restoreComment).not.toHaveBeenCalled();
  });

  it("words a restore that came too late (the window passed while the screen was open)", async () => {
    const hub = makeTransport();
    hub.restoreComment.mockRejectedValueOnce(new HubError("expired"));
    await renderSection(undoTransport([item()]), hub);
    await fireEvent.press(await screen.findByTestId("restore-comment-c1"));
    expect(await screen.findByTestId("restore-error-c1")).toHaveTextContent(
      "Too late to undo this.",
    );
  });

  it("words a post that can no longer be restored", async () => {
    const postsTransport = posts();
    postsTransport.restorePost.mockRejectedValueOnce(
      new CommunityError("not_restorable"),
    );
    await renderSection(
      undoTransport([item({ kind: "post", id: "p1", place: null })]),
      makeTransport(),
      postsTransport,
    );
    await fireEvent.press(await screen.findByTestId("restore-post-p1"));
    expect(await screen.findByTestId("restore-error-p1")).toHaveTextContent(
      "This can't be restored any more.",
    );
  });

  it("is worded in Sorani", async () => {
    await i18n.changeLanguage("ckb");
    await renderSection(undoTransport([item()]));
    expect(await screen.findByText("تازە سڕاوەکان")).toBeTruthy();
    expect(screen.getByText("گەڕاندنەوە")).toBeTruthy();
    await i18n.changeLanguage("en");
  });
});
