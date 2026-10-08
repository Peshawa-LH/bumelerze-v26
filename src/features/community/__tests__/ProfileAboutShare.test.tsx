import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

import { ProfileShareSheet } from "../components/ProfileShareSheet";
import { PublicProfileView } from "../components/PublicProfileView";
import type { CommunityActions } from "../queries";
import { parsePublicProfile } from "../transport";
import type { PublicProfile } from "../types";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "me" }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  getSupabaseClient: () => null,
}));
// A tiny town list: "duhok" is known (names in every language), others are not.
jest.mock("@/features/geo/use-place-index", () => ({
  usePlaceIndex: () => ({
    entries: [],
    byId: new Map([
      [
        "duhok",
        {
          id: "duhok",
          kind: "city",
          lat: 36.87,
          lon: 42.95,
          names: { en: "Duhok", ckb: "دهۆک", kmr: "Duhok", ar: "دهوك" },
        },
      ],
    ]),
  }),
}));
const mockShare = jest.fn();
const mockCopy = jest.fn();
jest.mock("@/features/share/share-text", () => ({
  shareText: (...args: unknown[]) => mockShare(...args),
  copyText: (...args: unknown[]) => mockCopy(...args),
}));

const BASE = {
  user_id: "u1",
  username: "dilan.k",
  display_name: "Dilan",
  avatar_path: null,
  is_private: false,
  roles: [],
  is_self: false,
  follow_status: "none",
  is_blocked: false,
  can_view_full: true,
  suspended: false,
  member_since: "2026-01-02T10:00:00Z",
  followers: 0,
  following: 0,
  comments: 0,
  helpful_received: 0,
  posts_count: 0,
  badges_hidden: false,
  milestones: null,
  recent_comments: [],
  bio: "Civil engineer, volunteer in Duhok",
  city_place_id: "duhok",
  city_name: "Duhok",
  pinned_post_id: "p9",
};

function build(overrides: Record<string, unknown> = {}): PublicProfile {
  const parsed = parsePublicProfile({ ...BASE, ...overrides });
  if (!parsed) throw new Error("fixture did not parse");
  return parsed;
}

const actions = {
  follow: jest.fn(),
  unfollow: jest.fn(),
  undoUnfollow: jest.fn(),
  undoDecline: jest.fn(),
  accept: jest.fn(),
  decline: jest.fn(),
  block: jest.fn(),
  unblock: jest.fn(),
  report: jest.fn(),
} as unknown as CommunityActions;

async function renderView(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 640 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        {ui}
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

describe("bio, city label and pinned post on a profile (0058)", () => {
  beforeEach(async () => {
    mockShare.mockReset();
    mockCopy.mockReset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("parses them from the full profile", () => {
    const details = build().details;
    expect(details?.bio).toBe("Civil engineer, volunteer in Duhok");
    expect(details?.city).toEqual({ placeId: "duhok", name: "Duhok" });
    expect(details?.pinnedPostId).toBe("p9");
  });

  it("a viewer without the full profile gets none of them, even if the payload had them", () => {
    const profile = build({ is_private: true, can_view_full: false });
    expect(profile.details).toBeNull();
  });

  it("shows the bio and 'Lives in' under the name", async () => {
    await renderView(<PublicProfileView profile={build()} actions={actions} />);
    expect(screen.getByTestId("profile-bio")).toHaveTextContent(
      "Civil engineer, volunteer in Duhok",
    );
    expect(screen.getByTestId("profile-city")).toHaveTextContent("Lives in Duhok");
  });

  it("writes the town in the reader's language when it is in the list (Sorani, RTL)", async () => {
    await i18n.changeLanguage("ckb");
    await renderView(<PublicProfileView profile={build()} actions={actions} />);
    expect(screen.getByTestId("profile-city")).toHaveTextContent(
      i18n.t("community.profile.livesIn", { place: "دهۆک" }),
    );
    expect(screen.getByTestId("profile-bio").props.style.textAlign).toBe("auto");
  });

  it("falls back to the stored name for a place not in the bundled list", async () => {
    await renderView(
      <PublicProfileView
        profile={build({ city_place_id: "n999", city_name: "Bersive" })}
        actions={actions}
      />,
    );
    expect(screen.getByTestId("profile-city")).toHaveTextContent("Lives in Bersive");
  });

  it("shows nothing when there is no bio and no city", async () => {
    await renderView(
      <PublicProfileView
        profile={build({ bio: null, city_place_id: null, city_name: null })}
        actions={actions}
      />,
    );
    expect(screen.queryByTestId("profile-about")).toBeNull();
  });

  it("a private account the viewer cannot see shows no bio or city", async () => {
    await renderView(
      <PublicProfileView
        profile={build({ is_private: true, can_view_full: false })}
        actions={actions}
      />,
    );
    expect(screen.queryByTestId("profile-bio")).toBeNull();
    expect(screen.queryByTestId("profile-city")).toBeNull();
  });
});

describe("Share profile: QR sheet", () => {
  afterEach(cleanup);

  it("shows the QR of the public link, the link left to right, and copies it", async () => {
    mockCopy.mockResolvedValue(true);
    const onClose = jest.fn();
    await renderView(
      <ProfileShareSheet username="dilan.k" displayName="Dilan" onClose={onClose} />,
    );
    expect(screen.getByTestId("profile-share-sheet-qr").props.accessibilityLabel).toBe(
      i18n.t("community.profile.qrLabel", { name: "Dilan" }),
    );
    const url = screen.getByTestId("profile-share-sheet-url");
    expect(url.props.children).toBe("https://bumelerze.com/app/u/dilan.k");
    expect(url.props.style.writingDirection).toBe("ltr");
    await act(async () => {
      fireEvent.press(screen.getByTestId("profile-share-sheet-copy"));
    });
    expect(mockCopy).toHaveBeenCalledWith("https://bumelerze.com/app/u/dilan.k");
    expect(screen.getByTestId("profile-share-sheet-notice")).toHaveTextContent(
      "Link copied",
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("profile-share-sheet-close"));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("encodes an unusual name in the link", async () => {
    await renderView(
      <ProfileShareSheet username="a b" displayName="A" onClose={jest.fn()} />,
    );
    expect(screen.getByTestId("profile-share-sheet-url").props.children).toBe(
      "https://bumelerze.com/app/u/a%20b",
    );
  });
});
