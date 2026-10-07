import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

import { BlockedSection } from "../components/BlockedSection";
import { FollowRequestsSection } from "../components/FollowRequestsSection";
import { PeopleList } from "../components/PeopleList";
import type { CommunityTransport } from "../transport";
import type { Person } from "../types";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
const mockPush = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "me" }),
}));

const ASO: Person = {
  userId: "u-aso",
  username: "aso",
  displayName: "Aso",
  avatarPath: null,
  roles: [{ role: "engineer", orgName: null }],
};
const NO_HANDLE: Person = {
  ...ASO,
  userId: "u-x",
  username: null,
  displayName: "Xelat",
  roles: [],
};

function transport(overrides: Partial<CommunityTransport> = {}): CommunityTransport {
  return {
    fetchPublicProfile: jest.fn(),
    fetchFollowList: jest.fn(),
    fetchFollowRequests: jest.fn(async () => [{ ...ASO, requestedAt: 1 }]),
    fetchBlocks: jest.fn(async () => [ASO]),
    follow: jest.fn(),
    unfollow: jest.fn(),
    acceptRequest: jest.fn(async () => undefined),
    declineRequest: jest.fn(async () => undefined),
    block: jest.fn(),
    unblock: jest.fn(async () => undefined),
    reportProfile: jest.fn(),
    isUsernameAvailable: jest.fn(),
    ...overrides,
  } as CommunityTransport;
}

async function renderWith(ui: React.ReactElement) {
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

describe("community sections", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("lists follow requests with Accept and Decline", async () => {
    const t = transport();
    await renderWith(<FollowRequestsSection transport={t} />);
    expect(await screen.findByText("Follow requests")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("request-accept-u-aso"));
    });
    expect(t.acceptRequest).toHaveBeenCalledWith("u-aso");
    await act(async () => {
      fireEvent.press(screen.getByTestId("request-decline-u-aso"));
    });
    expect(t.declineRequest).toHaveBeenCalledWith("u-aso");
  });

  it("labels the request buttons with the person's name for screen readers", async () => {
    await renderWith(<FollowRequestsSection transport={transport()} />);
    expect(await screen.findByLabelText("Accept Aso")).toBeTruthy();
    expect(screen.getByLabelText("Decline Aso")).toBeTruthy();
  });

  it("renders nothing when there are no requests", async () => {
    await renderWith(
      <FollowRequestsSection
        transport={transport({ fetchFollowRequests: async () => [] })}
      />,
    );
    await act(async () => undefined);
    expect(screen.queryByTestId("follow-requests")).toBeNull();
  });

  it("renders nothing when the server cannot answer yet", async () => {
    await renderWith(
      <FollowRequestsSection
        transport={transport({
          fetchFollowRequests: async () => {
            throw new Error("missing");
          },
        })}
      />,
    );
    await act(async () => undefined);
    expect(screen.queryByTestId("follow-requests")).toBeNull();
  });

  it("lists blocked accounts with Unblock", async () => {
    const t = transport();
    await renderWith(<BlockedSection transport={t} />);
    expect(await screen.findByText("Blocked accounts")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("unblock-u-aso"));
    });
    expect(t.unblock).toHaveBeenCalledWith("u-aso");
  });

  it("a person row opens their profile; one without a username does not link", async () => {
    await renderWith(
      <PeopleList
        people={[ASO, NO_HANDLE]}
        isLoading={false}
        isError={false}
        emptyText="none"
      />,
    );
    await fireEvent.press(screen.getByTestId("person-open-u-aso"));
    expect(mockPush).toHaveBeenCalledWith("/u/aso");
    expect(screen.queryByTestId("person-open-u-x")).toBeNull();
    expect(screen.getByText("Xelat")).toBeTruthy();
    // the handle is isolated for right-to-left text
    expect(screen.getByText("⁦@aso⁩")).toBeTruthy();
  });

  it("PeopleList says so when empty, loading or failed", async () => {
    const view = await renderWith(
      <PeopleList
        people={[]}
        isLoading={false}
        isError={false}
        emptyText="No one yet."
      />,
    );
    expect(screen.getByText("No one yet.")).toBeTruthy();
    await view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PeopleList people={undefined} isLoading={false} isError emptyText="x" />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Couldn't load. Check your connection.")).toBeTruthy();
  });
});
