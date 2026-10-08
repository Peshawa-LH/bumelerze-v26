import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

import { PublicProfileView } from "../components/PublicProfileView";
import type { ProfileReportReason } from "../constants";
import type { CommunityActions } from "../queries";
import { parsePublicProfile } from "../transport";
import { CommunityError, type PublicProfile } from "../types";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "me",
};
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));

const mockConfirm = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: jest.fn(),
}));

const PAYLOAD = {
  user_id: "u1",
  username: "dilan.k",
  display_name: "Dilan Ahmed",
  avatar_path: null,
  is_private: false,
  roles: [{ role: "seismologist", org_name: null }],
  is_self: false,
  follow_status: "none",
  is_blocked: false,
  can_view_full: true,
  member_since: "2026-01-02T10:00:00Z",
  followers: 4,
  following: 2,
  comments: 9,
  helpful_received: 12,
  badges_hidden: false,
  milestones: { reports: 3, detailed_reports: 1, photo_reports: 1 },
  recent_comments: [
    {
      comment_id: "c1",
      body: "Felt it strongly in the kitchen",
      created_at: "2026-10-01T10:00:00Z",
      helpful_count: 2,
      hub_id: "bml202610aa",
      place: "Near Slemani",
      magnitude: 4.2,
    },
    {
      comment_id: "c2",
      body: "No hub for this one",
      created_at: "2026-09-01T10:00:00Z",
      helpful_count: 0,
      hub_id: null,
      place: null,
      magnitude: null,
    },
  ],
};

function build(overrides: Record<string, unknown> = {}): PublicProfile {
  const profile = parsePublicProfile({ ...PAYLOAD, ...overrides });
  if (!profile) {
    throw new Error("fixture did not parse");
  }
  return profile;
}

function makeActions(): jest.Mocked<CommunityActions> {
  return {
    follow: jest.fn<ReturnType<CommunityActions["follow"]>, [string]>(
      async () => "accepted",
    ),
    unfollow: jest.fn<Promise<void>, [string]>(async () => undefined),
    undoUnfollow: jest.fn<Promise<void>, [string]>(async () => undefined),
    undoDecline: jest.fn<Promise<void>, [string]>(async () => undefined),
    accept: jest.fn<Promise<void>, [string]>(async () => undefined),
    decline: jest.fn<Promise<void>, [string]>(async () => undefined),
    block: jest.fn<Promise<void>, [string]>(async () => undefined),
    unblock: jest.fn<Promise<void>, [string]>(async () => undefined),
    report: jest.fn<Promise<void>, [string, ProfileReportReason]>(async () => undefined),
  } as jest.Mocked<CommunityActions>;
}

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderView(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>
    </QueryClientProvider>,
  );
}

function allText(): string {
  return JSON.stringify(screen.toJSON());
}

describe("PublicProfileView", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockConfirm.mockClear();
    mockAccount = { status: "account", userId: "me" };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("shows the name, @username, rank, counts and recent comments", async () => {
    await renderView(<PublicProfileView profile={build()} actions={makeActions()} />);
    expect(screen.getByTestId("public-profile-name").props.children).toBe("Dilan Ahmed");
    expect(screen.getByTestId("public-profile-username").props.children).toBe(
      "⁦@dilan.k⁩",
    );
    expect(screen.getByTestId("role-mark-seismologist")).toBeTruthy();
    expect(screen.getByTestId("public-profile-member-since")).toBeTruthy();
    expect(screen.getByTestId("count-followers")).toBeTruthy();
    expect(screen.getByText("Felt it strongly in the kitchen")).toBeTruthy();
    expect(screen.getByText("M 4.2 · Near Slemani")).toBeTruthy();
  });

  it("links a recent comment to its Event hub, and leaves one without a hub plain", async () => {
    await renderView(<PublicProfileView profile={build()} actions={makeActions()} />);
    await fireEvent.press(screen.getByTestId("profile-comment-c1"));
    expect(mockPush).toHaveBeenCalledWith("/event-hub/bml202610aa");
    expect(screen.getByTestId("profile-comment-c2").props.onPress).toBeUndefined();
  });

  it("opens the follower and following lists", async () => {
    await renderView(<PublicProfileView profile={build()} actions={makeActions()} />);
    await fireEvent.press(screen.getByTestId("count-followers"));
    expect(mockPush).toHaveBeenLastCalledWith("/u/dilan.k/people?kind=followers");
    await fireEvent.press(screen.getByTestId("count-following"));
    expect(mockPush).toHaveBeenLastCalledWith("/u/dilan.k/people?kind=following");
  });

  describe("privacy: nothing private can be rendered", () => {
    const SECRETS = [
      "dilan@example.com",
      "structural engineer",
      "sx8dx",
      "BMH-AAAAAA",
      "device-abc",
      "35.5612",
    ];

    it("never renders location, home tag, profession, email or device data, even if the server sent them", async () => {
      const leaky = {
        email: "dilan@example.com",
        profession: "structural engineer",
        geohash_p5: "sx8dx",
        home_tags: ["BMH-AAAAAA"],
        device_id: "device-abc",
        latitude: 35.5612,
        recent_comments: PAYLOAD.recent_comments.map((c) => ({
          ...c,
          area_geohash: "sx8dx",
          latitude: 35.5612,
        })),
      };
      await renderView(
        <PublicProfileView profile={build(leaky)} actions={makeActions()} />,
      );
      const text = allText();
      for (const secret of SECRETS) {
        expect(text).not.toContain(secret);
      }
    });

    it("hides the milestone badges when the owner hides them, keeping the rank", async () => {
      await renderView(
        <PublicProfileView
          profile={build({ badges_hidden: true, milestones: null })}
          actions={makeActions()}
        />,
      );
      expect(screen.getByTestId("badge-role-seismologist")).toBeTruthy();
      expect(screen.queryByTestId("badge-first_report")).toBeNull();
    });

    it("shows earned milestone badges but never the household ones", async () => {
      await renderView(<PublicProfileView profile={build()} actions={makeActions()} />);
      expect(screen.getByTestId("badge-first_report")).toBeTruthy();
      expect(screen.queryByTestId("badge-home_tagged")).toBeNull();
      expect(screen.queryByTestId("badge-family_linked")).toBeNull();
    });

    it("shows a private account to a non-follower as name, @username, photo and rank, with a Request button", async () => {
      await renderView(
        <PublicProfileView
          profile={build({
            is_private: true,
            can_view_full: false,
            member_since: undefined,
            followers: undefined,
            recent_comments: undefined,
          })}
          actions={makeActions()}
        />,
      );
      expect(screen.getByTestId("public-profile-name")).toBeTruthy();
      expect(screen.getByTestId("public-profile-username")).toBeTruthy();
      expect(screen.getByTestId("role-mark-seismologist")).toBeTruthy();
      expect(screen.getByLabelText(/Request: Dilan Ahmed/)).toBeTruthy();
      expect(screen.getByTestId("public-profile-private-note")).toBeTruthy();
      expect(screen.queryByTestId("profile-counts")).toBeNull();
      expect(screen.queryByTestId("public-profile-member-since")).toBeNull();
      expect(screen.queryByText("Felt it strongly in the kitchen")).toBeNull();
      expect(screen.queryByTestId("badge-grid")).toBeNull();
    });

    it("does not show the details of a private account in the payload to a non-follower", async () => {
      await renderView(
        <PublicProfileView
          profile={build({ is_private: true, can_view_full: false })}
          actions={makeActions()}
        />,
      );
      expect(screen.queryByText("Felt it strongly in the kitchen")).toBeNull();
      expect(screen.queryByTestId("profile-counts")).toBeNull();
    });
  });

  describe("follow", () => {
    it("follows a public account", async () => {
      const actions = makeActions();
      await renderView(<PublicProfileView profile={build()} actions={actions} />);
      await act(async () => {
        fireEvent.press(screen.getByTestId("follow-button"));
      });
      expect(actions.follow).toHaveBeenCalledWith("u1");
    });

    it("unfollows when already following", async () => {
      const actions = makeActions();
      await renderView(
        <PublicProfileView
          profile={build({ follow_status: "accepted" })}
          actions={actions}
        />,
      );
      expect(screen.getByLabelText(/Following: Dilan Ahmed/)).toBeTruthy();
      await act(async () => {
        fireEvent.press(screen.getByTestId("follow-button"));
      });
      expect(actions.unfollow).toHaveBeenCalledWith("u1");
    });

    it("labels a pending request 'Requested'", async () => {
      await renderView(
        <PublicProfileView
          profile={build({
            is_private: true,
            follow_status: "pending",
            can_view_full: false,
          })}
          actions={makeActions()}
        />,
      );
      expect(screen.getByLabelText(/Requested: Dilan Ahmed/)).toBeTruthy();
      expect(
        screen.getByText("Request sent. You will see more once it is accepted."),
      ).toBeTruthy();
    });

    it("sends an install without an account to sign-in instead of following", async () => {
      mockAccount = { status: "anonymous", userId: "anon" };
      const actions = makeActions();
      await renderView(<PublicProfileView profile={build()} actions={actions} />);
      await act(async () => {
        fireEvent.press(screen.getByTestId("follow-button"));
      });
      expect(actions.follow).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/account/sign-in");
    });

    it("words a failure instead of throwing", async () => {
      const actions = makeActions();
      actions.follow.mockRejectedValueOnce(new CommunityError("profile_required"));
      await renderView(<PublicProfileView profile={build()} actions={actions} />);
      await act(async () => {
        fireEvent.press(screen.getByTestId("follow-button"));
      });
      expect(await screen.findByText("Finish your profile first.")).toBeTruthy();
    });

    it("offers Edit profile on your own page and no follow, block or report", async () => {
      await renderView(
        <PublicProfileView profile={build({ is_self: true })} actions={makeActions()} />,
      );
      expect(screen.getByTestId("public-profile-edit")).toBeTruthy();
      expect(screen.queryByTestId("follow-button")).toBeNull();
      expect(screen.queryByTestId("public-profile-block")).toBeNull();
      expect(screen.queryByTestId("public-profile-report")).toBeNull();
    });
  });

  describe("block and report", () => {
    it("asks before blocking, then blocks", async () => {
      const actions = makeActions();
      await renderView(<PublicProfileView profile={build()} actions={actions} />);
      await fireEvent.press(screen.getByTestId("public-profile-block"));
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(actions.block).not.toHaveBeenCalled();
      const options = mockConfirm.mock.calls[0]?.[0] as {
        destructive: boolean;
        onConfirm: () => void;
      };
      expect(options.destructive).toBe(true);
      options.onConfirm();
      await waitFor(() => expect(actions.block).toHaveBeenCalledWith("u1"));
    });

    it("shows a blocked profile with only Unblock", async () => {
      const actions = makeActions();
      await renderView(
        <PublicProfileView
          profile={build({ is_blocked: true, can_view_full: false })}
          actions={actions}
        />,
      );
      expect(screen.getByTestId("public-profile-blocked")).toBeTruthy();
      expect(screen.queryByTestId("follow-button")).toBeNull();
      expect(screen.queryByTestId("profile-counts")).toBeNull();
      await act(async () => {
        fireEvent.press(screen.getByTestId("public-profile-unblock"));
      });
      expect(actions.unblock).toHaveBeenCalledWith("u1");
    });

    it("reports a profile with a reason", async () => {
      const actions = makeActions();
      await renderView(<PublicProfileView profile={build()} actions={actions} />);
      await fireEvent.press(screen.getByTestId("public-profile-report"));
      expect(screen.getByText("Report this profile")).toBeTruthy();
      await fireEvent.press(
        screen.getByTestId("public-profile-report-sheet-reason-impersonation"),
      );
      await fireEvent.changeText(
        screen.getByTestId("public-profile-report-sheet-note"),
        "uses my name",
      );
      await act(async () => {
        fireEvent.press(screen.getByTestId("public-profile-report-sheet-submit"));
      });
      expect(actions.report).toHaveBeenCalledWith("u1", "impersonation", "uses my name");
      expect(await screen.findByText("Thanks. We will review it.")).toBeTruthy();
      expect(screen.queryByTestId("public-profile-report-sheet")).toBeNull();
    });
  });

  describe.each(["ckb", "kmr", "ar"])("in %s", (locale) => {
    afterEach(async () => {
      await i18n.changeLanguage("en");
    });

    it("renders without raw keys and keeps the @username isolated", async () => {
      await i18n.changeLanguage(locale);
      await renderView(<PublicProfileView profile={build()} actions={makeActions()} />);
      expect(allText()).not.toMatch(/community\.|myData\.|eventHub\./);
      expect(screen.getByTestId("public-profile-username").props.children).toBe(
        "\u2066@dilan.k\u2069",
      );
      expect(screen.getByTestId("follow-button")).toBeTruthy();
    });
  });
});
