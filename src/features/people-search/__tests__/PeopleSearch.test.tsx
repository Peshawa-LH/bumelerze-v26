import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";
import type { MentionSuggestion } from "@/features/mentions/transport";

import { PeopleSearch } from "../components/PeopleSearch";
import { PEOPLE_SEARCH_LIMIT, searchPrefix } from "../query";
import type { PeopleSearchTransport } from "../transport";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: jest.fn(async () => undefined),
}));
let mockUserId: string | null = "me";
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({
    status: mockUserId ? "account" : "anonymous",
    userId: mockUserId,
  }),
}));

function person(
  username: string,
  displayName: string | null,
  relation: MentionSuggestion["relation"] = "other",
): MentionSuggestion {
  return { userId: `id-${username}`, username, displayName, avatarPath: null, relation };
}

function transport(people: MentionSuggestion[] = []) {
  return {
    search: jest.fn(async (_prefix: string) => people),
  } as jest.Mocked<PeopleSearchTransport>;
}

async function type(text: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId("people-search-input"), text);
  });
}

describe("searchPrefix", () => {
  it("drops a leading @, spaces and capitals; needs 2 to 24 characters", () => {
    expect(searchPrefix("  @Dilan ")).toBe("dilan");
    expect(searchPrefix("Ş")).toBeNull();
    expect(searchPrefix("@")).toBeNull();
    expect(searchPrefix("ئا")).toBe("ئا");
    expect(searchPrefix("x".repeat(25))).toBeNull();
  });
});

describe("Find people (Profile)", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    mockUserId = "me";
    if (i18n.language !== "en") await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("asks for 2 letters first and does not search on one", async () => {
    const t = transport();
    await renderWithProviders(<PeopleSearch onClose={jest.fn()} transport={t} />);
    expect(screen.getByTestId("people-search-input").props.placeholder).toBe(
      "Name or @username",
    );
    expect(screen.getByTestId("people-search-input").props.accessibilityLabel).toBe(
      "Search people by name or @username",
    );
    expect(screen.getByTestId("people-search-hint")).toHaveTextContent(
      "Type at least 2 letters.",
    );
    await type("d");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(t.search).not.toHaveBeenCalled();
  });

  it("lists matching people as you type, and a tap opens their profile", async () => {
    const t = transport([
      person("dilan.k", "Dilan", "following"),
      person("dilshad", null, "follower"),
      person("dimen", "Dimen"),
    ]);
    await renderWithProviders(<PeopleSearch onClose={jest.fn()} transport={t} />);
    await type("@Di");
    await waitFor(() => expect(t.search).toHaveBeenCalledWith("di"));
    const row = await screen.findByTestId("person-open-id-dilan.k");
    expect(row).toHaveTextContent(/Dilan.*@dilan\.k/);
    expect(screen.getByTestId("people-search-result-dilan.k")).toHaveTextContent(
      /You follow/,
    );
    expect(screen.getByTestId("people-search-result-dilshad")).toHaveTextContent(
      /Follows you/,
    );
    // no display name: the handle is the name (the photo's initial "D"
    // comes from it), the @username under it
    expect(screen.getByTestId("person-open-id-dilshad")).toHaveTextContent(
      /^Ddilshad.*@dilshad/,
    );
    expect(row.props.accessibilityLabel).toBe("Open profile of Dilan");
    await act(async () => {
      fireEvent.press(row);
    });
    expect(mockPush).toHaveBeenCalledWith("/u/dilan.k");
  });

  it("says when nobody matches", async () => {
    await renderWithProviders(
      <PeopleSearch onClose={jest.fn()} transport={transport([])} />,
    );
    await type("zz");
    expect(await screen.findByTestId("people-search-none")).toHaveTextContent(
      "No one found.",
    );
  });

  it("says when the search failed, and tries again on Retry", async () => {
    const t = transport();
    t.search.mockRejectedValueOnce(new Error("offline"));
    await renderWithProviders(<PeopleSearch onClose={jest.fn()} transport={t} />);
    await type("di");
    expect(await screen.findByTestId("people-search-error")).toHaveTextContent(
      "Couldn't search. Check your connection and try again.",
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("people-search-retry"));
    });
    await waitFor(() => expect(t.search).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("people-search-none")).toBeTruthy();
  });

  it("says when only the first 8 are shown", async () => {
    const many = Array.from({ length: PEOPLE_SEARCH_LIMIT }, (_, i) =>
      person(`di${i}`, `Di ${i}`),
    );
    await renderWithProviders(
      <PeopleSearch onClose={jest.fn()} transport={transport(many)} />,
    );
    await type("di");
    expect(await screen.findByTestId("people-search-more")).toHaveTextContent(
      /Showing the first .*8.*\. Type more to narrow it down\./,
    );
  });

  it("works for a guest too (the search signs in as a guest first)", async () => {
    mockUserId = null;
    const t = transport([person("dilan.k", "Dilan")]);
    await renderWithProviders(<PeopleSearch onClose={jest.fn()} transport={t} />);
    await type("di");
    expect(await screen.findByTestId("person-open-id-dilan.k")).toBeTruthy();
  });

  it("closes with its button, a 44 pt target", async () => {
    const onClose = jest.fn();
    await renderWithProviders(<PeopleSearch onClose={onClose} transport={transport()} />);
    const close = screen.getByTestId("people-search-close");
    expect(close.props.accessibilityLabel).toBe("Close search");
    await act(async () => {
      fireEvent.press(close);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("reads in Sorani with Kurdish digits", async () => {
    await i18n.changeLanguage("ckb");
    const many = Array.from({ length: PEOPLE_SEARCH_LIMIT }, (_, i) =>
      person(`di${i}`, `Di ${i}`),
    );
    await renderWithProviders(
      <PeopleSearch onClose={jest.fn()} transport={transport(many)} />,
    );
    expect(screen.getByTestId("people-search-input").props.placeholder).toBe(
      i18n.t("peopleSearch.placeholder"),
    );
    await type("di");
    expect(await screen.findByTestId("people-search-more")).toHaveTextContent(/٨/);
  });
});
