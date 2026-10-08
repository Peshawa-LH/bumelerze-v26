import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SnackbarProvider } from "@/components/Snackbar";
import i18n from "@/i18n";

import { FollowButton } from "../components/FollowButton";
import { FollowRequestsSection } from "../components/FollowRequestsSection";
import type { CommunityActions } from "../queries";
import type { CommunityTransport } from "../transport";
import type { FollowStatus, PublicProfile } from "../types";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "me" }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={metrics}>
        <SnackbarProvider>{ui}</SnackbarProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

function profile(followStatus: FollowStatus, isPrivate = false): PublicProfile {
  return {
    userId: "u1",
    username: "dilan",
    displayName: "Dilan",
    avatarPath: null,
    isPrivate,
    roles: [],
    isSelf: false,
    followStatus,
    isBlocked: false,
    canViewFull: true,
    details: null,
  };
}

function actions(): jest.Mocked<CommunityActions> {
  return {
    follow: jest.fn(async () => "accepted" as const),
    unfollow: jest.fn(async () => undefined),
    undoUnfollow: jest.fn(async () => undefined),
    undoDecline: jest.fn(async () => undefined),
    accept: jest.fn(async () => undefined),
    decline: jest.fn(async () => undefined),
    block: jest.fn(async () => undefined),
    unblock: jest.fn(async () => undefined),
    report: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<CommunityActions>;
}

describe("undoing a follow change", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  describe("unfollow", () => {
    it("unfollows at once and offers Undo, which calls undoUnfollow", async () => {
      const a = actions();
      await renderWith(<FollowButton profile={profile("accepted")} actions={a} />);
      await fireEvent.press(screen.getByTestId("follow-button"));
      await waitFor(() => expect(a.unfollow).toHaveBeenCalledWith("u1"));
      expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
        "You unfollowed Dilan",
      );
      expect(a.undoUnfollow).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId("snackbar-action"));
      await waitFor(() => expect(a.undoUnfollow).toHaveBeenCalledWith("u1"));
    });

    it("words cancelling a pending request differently", async () => {
      const a = actions();
      await renderWith(<FollowButton profile={profile("pending", true)} actions={a} />);
      await fireEvent.press(screen.getByTestId("follow-button"));
      expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
        "Request cancelled",
      );
    });

    it("following offers no Undo", async () => {
      const a = actions();
      await renderWith(<FollowButton profile={profile("none")} actions={a} />);
      await fireEvent.press(screen.getByTestId("follow-button"));
      await waitFor(() => expect(a.follow).toHaveBeenCalled());
      expect(screen.queryByTestId("snackbar")).toBeNull();
    });

    it("a failed unfollow offers no Undo either", async () => {
      const b = actions();
      b.unfollow.mockRejectedValueOnce(new Error("boom"));
      await renderWith(<FollowButton profile={profile("accepted")} actions={b} />);
      await fireEvent.press(screen.getByTestId("follow-button"));
      await waitFor(() => expect(b.unfollow).toHaveBeenCalled());
      expect(screen.queryByTestId("snackbar")).toBeNull();
    });

    it("tells the person when the minute is over", async () => {
      const a = actions();
      a.undoUnfollow.mockRejectedValueOnce(new Error("expired"));
      await renderWith(<FollowButton profile={profile("accepted")} actions={a} />);
      await fireEvent.press(screen.getByTestId("follow-button"));
      await fireEvent.press(await screen.findByTestId("snackbar-action"));
      expect(await screen.findByText("Couldn't undo. It may be too late.")).toBeTruthy();
    });
  });

  describe("declining a follow request", () => {
    const requester = {
      userId: "u-aso",
      username: "aso",
      displayName: "Aso",
      avatarPath: null,
      roles: [],
      requestedAt: 1,
    };

    function transport(): CommunityTransport {
      return {
        fetchFollowRequests: jest.fn(async () => [requester]),
        acceptRequest: jest.fn(async () => undefined),
        declineRequest: jest.fn(async () => undefined),
        undoDecline: jest.fn(async () => undefined),
      } as unknown as CommunityTransport;
    }

    it("declines at once and offers Undo, which puts the request back", async () => {
      const t = transport();
      await renderWith(<FollowRequestsSection transport={t} />);
      await fireEvent.press(await screen.findByTestId("request-decline-u-aso"));
      await waitFor(() => expect(t.declineRequest).toHaveBeenCalledWith("u-aso"));
      expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
        "Request declined",
      );
      await fireEvent.press(screen.getByTestId("snackbar-action"));
      await waitFor(() => expect(t.undoDecline).toHaveBeenCalledWith("u-aso"));
    });

    it("accepting offers no Undo", async () => {
      const t = transport();
      await renderWith(<FollowRequestsSection transport={t} />);
      await fireEvent.press(await screen.findByTestId("request-accept-u-aso"));
      await waitFor(() => expect(t.acceptRequest).toHaveBeenCalledWith("u-aso"));
      expect(screen.queryByTestId("snackbar")).toBeNull();
    });
  });
});
