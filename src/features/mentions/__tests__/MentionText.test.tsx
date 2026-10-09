import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, Text } from "react-native";

import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import { CommentComposer } from "@/features/eventhub/components/CommentComposer";
import { PostComposer } from "@/features/posts/components/PostComposer";

import { MentionText } from "../components/MentionText";
import type { MentionsTransport } from "../transport";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: jest.fn(async () => undefined),
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "me" }),
}));

const LRI = "⁦";
const PDI = "⁩";

function fake(existing: string[] = ["shirin", "aso"]): jest.Mocked<MentionsTransport> {
  return {
    lookup: jest.fn(async (names: readonly string[]) =>
      names.filter((name) => existing.includes(name)),
    ),
    suggest: jest.fn(async (prefix: string) =>
      [
        {
          userId: "u1",
          username: "shirin",
          displayName: "Shirin",
          avatarPath: null,
          relation: "following" as const,
        },
        {
          userId: "u2",
          username: "shilan",
          displayName: "Shilan",
          avatarPath: null,
          relation: "other" as const,
        },
      ].filter((p) => p.username.startsWith(prefix)),
    ),
  };
}

describe("MentionText", () => {
  beforeEach(() => mockPush.mockClear());
  afterEach(cleanup);

  it("links names that exist, leaves the rest plain, and keeps the link left-to-right", async () => {
    const transport = fake();
    await renderWithProviders(
      <MentionText
        text="سڵاو @Shirin و @nobody، @aso."
        transport={transport}
        testID="body"
      />,
    );
    const link = await screen.findByTestId("mention-link-shirin");
    expect(link.props.children).toBe(`${LRI}@Shirin${PDI}`);
    expect(screen.getByTestId("mention-link-aso").props.children).toBe(
      `${LRI}@aso${PDI}`,
    );
    expect(screen.queryByTestId("mention-link-nobody")).toBeNull();
    // every character of the text is still there
    const flat = (node: unknown): string =>
      typeof node === "string"
        ? node
        : Array.isArray(node)
          ? node.map(flat).join("")
          : node && typeof node === "object" && "props" in node
            ? flat((node as { props: { children: unknown } }).props.children)
            : "";
    expect(flat(screen.getByTestId("body").props.children).replace(/[⁦⁩]/g, "")).toBe(
      "سڵاو @Shirin و @nobody، @aso.",
    );
    await fireEvent.press(link);
    expect(mockPush).toHaveBeenCalledWith("/u/shirin");
    expect(transport.lookup).toHaveBeenCalledTimes(1);
  });

  it("asks nothing for a text without a mention", async () => {
    const transport = fake();
    await renderWithProviders(<MentionText text="no names here" transport={transport} />);
    expect(screen.getByText("no names here")).toBeTruthy();
    expect(transport.lookup).not.toHaveBeenCalled();
  });

  it("reads as plain text while the lookup fails (offline)", async () => {
    const transport = fake();
    transport.lookup.mockRejectedValue(new Error("offline"));
    await renderWithProviders(
      <Text>
        <MentionText text="hi @shirin" transport={transport} testID="body" />
      </Text>,
    );
    await waitFor(() => expect(transport.lookup).toHaveBeenCalled());
    expect(screen.queryByTestId("mention-link-shirin")).toBeNull();
  });
});

describe("composer suggestions", () => {
  afterEach(cleanup);

  it("the hub composer suggests people for @ + 2 characters and writes the pick", async () => {
    const transport = fake();
    await renderWithProviders(
      <CommentComposer
        isAccount
        placeholder="Write"
        onSubmit={jest.fn(async () => undefined)}
        guidelinesTransport={{ accept: jest.fn(async () => undefined) }}
        mentionsTransport={transport}
      />,
    );
    const input = screen.getByTestId("hub-composer-input");
    await fireEvent.changeText(input, "felt it with @s");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByTestId("hub-composer-mentions")).toBeNull();
    expect(transport.suggest).not.toHaveBeenCalled();

    await fireEvent.changeText(input, "felt it with @sh");
    expect(await screen.findByTestId("hub-composer-mentions-shirin")).toBeTruthy();
    expect(screen.getByTestId("hub-composer-mentions-shilan")).toBeTruthy();
    expect(transport.suggest).toHaveBeenCalledWith("sh");

    await fireEvent.press(screen.getByTestId("hub-composer-mentions-shirin"));
    expect(screen.getByTestId("hub-composer-input").props.value).toBe(
      "felt it with @shirin ",
    );
    await waitFor(() => expect(screen.queryByTestId("hub-composer-mentions")).toBeNull());
  });

  it("the post composer suggests too, and not while the account is limited", async () => {
    const transport = fake();
    function Harness() {
      const [limited, setLimited] = useState(false);
      return (
        <>
          <Pressable testID="limit" onPress={() => setLimited(true)} />
          <PostComposer
            onSubmit={jest.fn(async () => undefined)}
            mentionsTransport={transport}
            disabled={limited}
          />
        </>
      );
    }
    await renderWithProviders(<Harness />);
    await fireEvent.changeText(screen.getByTestId("post-composer-input"), "@shi");
    expect(await screen.findByTestId("post-composer-mentions-shirin")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("limit"));
    await waitFor(() =>
      expect(screen.queryByTestId("post-composer-mentions")).toBeNull(),
    );
  });
});
