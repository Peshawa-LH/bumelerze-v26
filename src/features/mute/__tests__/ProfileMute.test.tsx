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

import { PublicProfileView } from "@/features/community/components/PublicProfileView";
import type { CommunityActions } from "@/features/community/queries";
import { parsePublicProfile } from "@/features/community/transport";
import type { PublicProfile } from "@/features/community/types";
import i18n from "@/i18n";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
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

const mockMuted: { person_id: string }[] = [];
const mockMute = jest.fn(async (id: string) => {
  mockMuted.push({ person_id: id });
});
const mockUnmute = jest.fn(async (id: string) => {
  mockMuted.splice(
    mockMuted.findIndex((m) => m.person_id === id),
    1,
  );
});
jest.mock("../transport", () => {
  const actual = jest.requireActual("../transport");
  return {
    ...actual,
    SupabaseMuteTransport: {
      fetchMuted: async () => actual.parseMutedRows([...mockMuted]),
      mute: (id: string) => mockMute(id),
      unmute: (id: string) => mockUnmute(id),
    },
  };
});

function build(overrides: Record<string, unknown> = {}): PublicProfile {
  const profile = parsePublicProfile({
    user_id: "u1",
    username: "dilan.k",
    display_name: "Dilan Ahmed",
    is_private: false,
    is_self: false,
    follow_status: "none",
    is_blocked: false,
    can_view_full: true,
    followers: 1,
    following: 1,
    comments: 1,
    recent_comments: [
      {
        comment_id: "c1",
        body: "Felt it strongly in the kitchen",
        created_at: "2026-10-01T10:00:00Z",
        helpful_count: 0,
      },
    ],
    ...overrides,
  });
  if (!profile) {
    throw new Error("fixture did not parse");
  }
  return profile;
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

describe("Mute on a profile", () => {
  beforeEach(async () => {
    mockMuted.length = 0;
    jest.clearAllMocks();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("Mute hides their posts and comments here, for me, and offers Unmute", async () => {
    await renderView(<PublicProfileView profile={build()} actions={actions} />);
    expect(await screen.findByText("Felt it strongly in the kitchen")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("public-profile-mute"));
    });
    expect(mockMute).toHaveBeenCalledWith("u1");
    expect(await screen.findByTestId("public-profile-muted")).toBeTruthy();
    expect(screen.queryByText("Felt it strongly in the kitchen")).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId("public-profile-unmute"));
    });
    expect(mockUnmute).toHaveBeenCalledWith("u1");
    await waitFor(() => expect(screen.queryByTestId("public-profile-muted")).toBeNull());
  });

  it("my own page has no Mute", async () => {
    await renderView(
      <PublicProfileView profile={build({ is_self: true })} actions={actions} />,
    );
    await waitFor(() => expect(screen.queryByTestId("public-profile-mute")).toBeNull());
  });
});
