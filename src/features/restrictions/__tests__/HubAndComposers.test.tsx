import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { CommentComposer } from "@/features/eventhub/components/CommentComposer";
import { EventHubContent } from "@/features/eventhub/components/EventHubContent";
import {
  buildComment,
  buildEvent,
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import { HubError } from "@/features/eventhub/types";
import { PostComposer } from "@/features/posts/components/PostComposer";
import i18n from "@/i18n";

import { SupabaseRestrictionsTransport } from "../transport";
import { mine } from "../__fixtures__/testing";

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
let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "me",
};
jest.mock("@/features/account", () => ({
  ...jest.requireActual("@/features/account"),
  useAccount: () => mockAccount,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => mockAccount,
}));

async function renderHub(transport: ReturnType<typeof makeTransport>) {
  await renderWithProviders(
    <EventHubContent event={buildEvent()} transport={transport} />,
  );
}

describe("composers of a limited account", () => {
  afterEach(cleanup);

  it("the comment box and Post button are off, with a short reason", async () => {
    const onSubmit = jest.fn(async () => undefined);
    await renderWithProviders(
      <CommentComposer isAccount placeholder="Write" onSubmit={onSubmit} disabled />,
    );
    expect(screen.getByTestId("hub-composer-input").props.editable).toBe(false);
    await fireEvent.changeText(screen.getByTestId("hub-composer-input"), "hello");
    expect(
      screen.getByTestId("hub-composer-post").props.accessibilityState.disabled,
    ).toBe(true);
    await fireEvent.press(screen.getByTestId("hub-composer-post"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("hub-composer-disabled")).toHaveTextContent(
      "Your account is limited, so you can't write right now.",
    );
  });

  it("an ordinary composer is unchanged", async () => {
    await renderWithProviders(
      <CommentComposer
        isAccount
        placeholder="Write"
        onSubmit={jest.fn(async () => undefined)}
      />,
    );
    expect(screen.getByTestId("hub-composer-input").props.editable).toBe(true);
    expect(screen.queryByTestId("hub-composer-disabled")).toBeNull();
  });

  it("the post box is off too", async () => {
    const onSubmit = jest.fn(async () => undefined);
    await renderWithProviders(<PostComposer onSubmit={onSubmit} disabled />);
    expect(screen.getByTestId("post-composer-input").props.editable).toBe(false);
    await fireEvent.changeText(screen.getByTestId("post-composer-input"), "hello");
    await fireEvent.press(screen.getByTestId("post-composer-post"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("post-composer-disabled")).toBeTruthy();
  });

  it("words a refusal from the server in the comment box", async () => {
    const onSubmit = jest.fn(async () => {
      throw new HubError("restricted");
    });
    await renderWithProviders(
      <CommentComposer isAccount placeholder="Write" onSubmit={onSubmit} />,
    );
    await fireEvent.changeText(screen.getByTestId("hub-composer-input"), "hello");
    await fireEvent.press(screen.getByTestId("hub-composer-post"));
    expect(
      await screen.findByText("Your account is limited right now. You can't write."),
    ).toBeTruthy();
  });
});

describe("Event hub for a limited account", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockAccount = { status: "account", userId: "me" };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(() => {
    jest.restoreAllMocks();
    return cleanup();
  });

  it("shows the banner, switches the composer off and still lets the person read", async () => {
    jest
      .spyOn(SupabaseRestrictionsTransport, "fetchMine")
      .mockResolvedValue(mine({ level: "restrict" }));
    await renderHub(
      makeTransport({
        comments: [buildComment({ id: "c1", userId: "u-other", body: "Felt it a lot" })],
        authors: { "u-other": { displayName: "Dilan" } },
      }),
    );
    expect(await screen.findByTestId("restriction-banner")).toBeTruthy();
    expect(screen.getByText("Felt it a lot")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("hub-composer-input").props.editable).toBe(false),
    );
    // a reply box is off as well
    await fireEvent.press(screen.getByText("Reply"));
    await waitFor(() =>
      expect(screen.getByTestId("reply-composer-c1-input").props.editable).toBe(false),
    );
  });

  it("a warning changes nothing about writing", async () => {
    jest
      .spyOn(SupabaseRestrictionsTransport, "fetchMine")
      .mockResolvedValue(mine({ level: "warning", reason: "careful" }));
    await renderHub(makeTransport());
    expect(await screen.findByTestId("restriction-banner")).toBeTruthy();
    expect(screen.getByTestId("hub-composer-input").props.editable).toBe(true);
  });

  it("shows no banner and an open composer to everybody else", async () => {
    jest.spyOn(SupabaseRestrictionsTransport, "fetchMine").mockResolvedValue(null);
    await renderHub(makeTransport());
    await screen.findByTestId("hub-composer-input");
    expect(screen.queryByTestId("restriction-banner")).toBeNull();
    expect(screen.getByTestId("hub-composer-input").props.editable).toBe(true);
  });

  it("learns about a fresh limit from the server's refusal and shows the banner", async () => {
    const fetchMine = jest
      .spyOn(SupabaseRestrictionsTransport, "fetchMine")
      .mockResolvedValueOnce(null)
      .mockResolvedValue(mine());
    const transport = makeTransport(
      {},
      {
        postComment: jest.fn(async () => {
          throw new HubError("restricted");
        }),
      },
    );
    await renderHub(transport);
    await fireEvent.changeText(await screen.findByTestId("hub-composer-input"), "hello");
    await fireEvent.press(screen.getByTestId("hub-composer-post"));
    expect(
      await screen.findByText("Your account is limited right now. You can't write."),
    ).toBeTruthy();
    expect(await screen.findByTestId("restriction-banner")).toBeTruthy();
    expect(fetchMine).toHaveBeenCalledTimes(2);
  });
});

describe("'Limit account' in the Event hub comment menu", () => {
  const others = buildComment({
    id: "c1",
    userId: "u-other",
    body: "Rumour: quake at 9pm",
  });
  const mods = buildComment({ id: "c2", userId: "u-mod", body: "Official note" });
  const own = buildComment({ id: "c3", userId: "admin-1", body: "My own words" });

  beforeEach(async () => {
    mockPush.mockClear();
    mockAccount = { status: "account", userId: "admin-1" };
    jest.spyOn(SupabaseRestrictionsTransport, "fetchMine").mockResolvedValue(null);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(() => {
    jest.restoreAllMocks();
    return cleanup();
  });

  function hubWith(permissions: Parameters<typeof makeTransport>[0]) {
    return makeTransport({
      comments: [others, mods, own],
      authors: {
        "u-other": { displayName: "Dilan" },
        "u-mod": { displayName: "Mona" },
        "admin-1": { displayName: "Boss" },
      },
      roles: {
        "u-mod": [{ role: "moderator", orgName: null }],
        "admin-1": [{ role: "official", orgName: null }],
      },
      ...permissions,
    });
  }

  it("a moderator can limit an ordinary author, not an admin, not themself", async () => {
    await renderHub(hubWith({ permissions: ["comments.moderate", "accounts.restrict"] }));
    expect(await screen.findByTestId("limit-c1")).toBeTruthy();
    expect(screen.queryByTestId("limit-c2")).toBeNull();
    expect(screen.queryByTestId("limit-c3")).toBeNull();
  });

  it("the sheet opens for that author, without Suspend for a moderator", async () => {
    await renderHub(hubWith({ permissions: ["comments.moderate", "accounts.restrict"] }));
    await fireEvent.press(await screen.findByTestId("limit-c1"));
    expect(await screen.findByTestId("limit-sheet-target")).toHaveTextContent("Dilan");
    expect(screen.queryByTestId("limit-level-suspend")).toBeNull();
  });

  it("the official rank gets Suspend in the same sheet", async () => {
    await renderHub(
      hubWith({
        permissions: ["comments.moderate", "accounts.restrict", "accounts.suspend"],
      }),
    );
    await fireEvent.press(await screen.findByTestId("limit-c1"));
    expect(await screen.findByTestId("limit-level-suspend")).toBeTruthy();
  });

  it("offers nothing to someone without accounts.restrict", async () => {
    await renderHub(hubWith({ permissions: ["comments.moderate"] }));
    await screen.findByText("Rumour: quake at 9pm");
    expect(screen.queryByTestId("limit-c1")).toBeNull();
  });

  it("limits the author through the server and offers Undo", async () => {
    const restrict = jest
      .spyOn(SupabaseRestrictionsTransport, "restrict")
      .mockResolvedValue("r-new");
    const lift = jest.spyOn(SupabaseRestrictionsTransport, "lift").mockResolvedValue();
    await renderHub(hubWith({ permissions: ["comments.moderate", "accounts.restrict"] }));
    await fireEvent.press(await screen.findByTestId("limit-c1"));
    await fireEvent.press(await screen.findByTestId("limit-reason-rumour"));
    await fireEvent.press(screen.getByTestId("limit-submit"));
    await waitFor(() =>
      expect(restrict).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "u-other",
          level: "restrict",
          reason: "rumour",
        }),
      ),
    );
    await fireEvent.press(await screen.findByTestId("snackbar-action"));
    await waitFor(() => expect(lift).toHaveBeenCalledWith("r-new"));
  });
});
