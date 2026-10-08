import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { buildThreads } from "@/features/eventhub/threads";
import { EventHubContent } from "@/features/eventhub/components/EventHubContent";
import {
  buildComment,
  buildEvent,
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import i18n from "@/i18n";

import { MutedSection } from "../components/MutedSection";
import { parseMutedRows, type MuteTransport } from "../transport";

const mockPush = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
  };
});
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/feltmap/use-event-uuid", () => ({
  useEventUuid: () => "uuid-1",
  useEventUuidResult: () => ({ uuid: "uuid-1", isPending: false }),
}));
const mockAccount = { status: "account", userId: "acct-1" };
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));
jest.mock("@/features/account", () => ({
  ...jest.requireActual("@/features/account"),
  useAccount: () => mockAccount,
}));

// The app's mute transport, replaced by a fake the tests drive.
const mockMuted: {
  person_id: string;
  username: string | null;
  display_name: string | null;
}[] = [];
const mockMute = jest.fn(async (_id: string) => undefined);
const mockUnmute = jest.fn(async (_id: string) => undefined);
jest.mock("../transport", () => {
  const actual = jest.requireActual("../transport");
  return {
    ...actual,
    SupabaseMuteTransport: {
      fetchMuted: async () => actual.parseMutedRows(mockMuted),
      mute: (id: string) => mockMute(id),
      unmute: (id: string) => mockUnmute(id),
    },
  };
});

describe("mute", () => {
  beforeEach(async () => {
    mockMuted.length = 0;
    jest.clearAllMocks();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("parses my_mutes rows, guests included", () => {
    expect(
      parseMutedRows([
        { person_id: "u1", username: "a", display_name: "A", avatar_path: null },
        { person_id: "g1", username: null, display_name: null },
        { nope: true },
      ]),
    ).toEqual([
      { userId: "u1", username: "a", displayName: "A", avatarPath: null },
      { userId: "g1", username: null, displayName: null, avatarPath: null },
    ]);
  });

  it("threads leave out a muted author's comments (and the replies under them), never my own", () => {
    const comments = [
      buildComment({ id: "m1", userId: "u-muted", body: "muted root" }),
      buildComment({
        id: "r1",
        userId: "u-other",
        parentId: "m1",
        body: "reply to muted",
      }),
      buildComment({ id: "o1", userId: "u-other", body: "other root" }),
      buildComment({ id: "m2", userId: "u-muted", parentId: "o1", body: "muted reply" }),
      buildComment({ id: "me", userId: "acct-1", body: "mine" }),
    ];
    const threads = buildThreads(comments, {
      userId: "acct-1",
      isModerator: false,
      mutedIds: new Set(["u-muted", "acct-1"]),
    });
    const ids = threads.flatMap((t) => [t.root.id, ...t.replies.map((r) => r.id)]);
    expect(ids.sort()).toEqual(["me", "o1"]);
  });

  it("the Event hub hides muted people's comments for me", async () => {
    mockMuted.push({ person_id: "u-muted", username: "mu", display_name: "Muted One" });
    const transport = makeTransport({
      comments: [
        buildComment({ id: "c-muted", userId: "u-muted", body: "Prediction tomorrow!" }),
        buildComment({ id: "c-other", userId: "u-other", body: "Felt it in Erbil" }),
      ],
      authors: {
        "u-muted": { displayName: "Muted One" },
        "u-other": { displayName: "Other" },
      },
    });
    await renderWithProviders(
      <EventHubContent event={buildEvent()} transport={transport} />,
    );
    expect(await screen.findByText("Felt it in Erbil")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Prediction tomorrow!")).toBeNull());
  });

  it("Mute on a comment mutes its author quietly, with Undo", async () => {
    const transport = makeTransport({
      comments: [buildComment({ id: "c-other", userId: "u-other", body: "Felt it" })],
      authors: { "u-other": { displayName: "Other" } },
    });
    await renderWithProviders(
      <EventHubContent event={buildEvent()} transport={transport} />,
    );
    await screen.findByText("Felt it");
    await act(async () => {
      fireEvent.press(screen.getByTestId("mute-c-other"));
    });
    expect(mockMute).toHaveBeenCalledWith("u-other");
    expect(await screen.findByText("Other muted")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText("Undo"));
    });
    await waitFor(() => expect(mockUnmute).toHaveBeenCalledWith("u-other"));
  });

  it("no Mute on my own comment", async () => {
    const transport = makeTransport({
      comments: [buildComment({ id: "c-me", userId: "acct-1", body: "Mine" })],
    });
    await renderWithProviders(
      <EventHubContent event={buildEvent()} transport={transport} />,
    );
    await screen.findByText("Mine");
    expect(screen.queryByTestId("mute-c-me")).toBeNull();
  });

  it("Muted people lists them with Unmute; a guest is shown as Guest", async () => {
    const fake: jest.Mocked<MuteTransport> = {
      fetchMuted: jest.fn(async () => [
        { userId: "u1", username: "aso", displayName: "Aso", avatarPath: null },
        { userId: "g1", username: null, displayName: null, avatarPath: null },
      ]),
      mute: jest.fn(async (_userId: string) => undefined),
      unmute: jest.fn(async (_userId: string) => undefined),
    };
    await renderWithProviders(<MutedSection transport={fake} />);
    expect(await screen.findByText("Muted people")).toBeTruthy();
    expect(screen.getByText("Aso")).toBeTruthy();
    expect(screen.getByText("Guest")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("unmute-u1"));
    });
    expect(fake.unmute).toHaveBeenCalledWith("u1");
  });

  it("Muted people is hidden when nobody is muted", async () => {
    const fake: jest.Mocked<MuteTransport> = {
      fetchMuted: jest.fn(async () => []),
      mute: jest.fn(),
      unmute: jest.fn(),
    };
    await renderWithProviders(<MutedSection transport={fake} />);
    await waitFor(() => expect(fake.fetchMuted).toHaveBeenCalled());
    expect(screen.queryByTestId("muted-people")).toBeNull();
  });
});
