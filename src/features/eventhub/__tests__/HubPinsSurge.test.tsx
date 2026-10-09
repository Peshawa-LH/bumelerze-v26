import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";

import i18n from "@/i18n";
import { makeFilterTransport } from "@/features/contentfilter/__fixtures__/fake-filter";

import { EventHubContent } from "../components/EventHubContent";
import { RoleMark } from "../components/RoleMark";
import { buildThreads } from "../threads";
import {
  buildComment,
  buildEvent,
  makeTransport,
  renderWithProviders,
} from "../__fixtures__/testing";

/**
 * Migration 0059 in the Event hub: the pinned note comes first with the
 * official mark; only `hubs.feature` holders get Pin / Unpin; a calm note
 * explains busy-time review; a role mark explains itself when tapped.
 */

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useRouter: () => ({ push: jest.fn() }),
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
  userId: "acct-1",
};
jest.mock("@/features/account", () => ({
  ...jest.requireActual("@/features/account"),
  useAccount: () => mockAccount,
}));

const NOW = Date.now();
const comments = [
  buildComment({ id: "new", body: "Newest testimony", createdAt: NOW - 60_000 }),
  buildComment({
    id: "pinned",
    body: "Official note: aftershocks are normal",
    createdAt: NOW - 3 * 3_600_000,
    pinnedAt: NOW - 3_000_000,
  }),
  buildComment({ id: "mid", body: "Middle comment", createdAt: NOW - 600_000 }),
];

describe("pinned note, busy time and role marks", () => {
  beforeEach(async () => {
    mockAccount = { status: "account", userId: "acct-1" };
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("orders the pinned note first, before newer threads", () => {
    const threads = buildThreads(comments, { userId: null, isModerator: false });
    expect(threads.map((t) => t.root.id)).toEqual(["pinned", "new", "mid"]);
    // a pinned comment that is no longer visible is not "pinned"
    const hidden = buildThreads(
      comments.map((c) => (c.id === "pinned" ? { ...c, status: "hidden" as const } : c)),
      { userId: null, isModerator: true },
    );
    expect(hidden.map((t) => t.root.id)).toEqual(["new", "mid"]);
  });

  it("shows 'Pinned by Bumelerze' with the official mark, and no pin buttons for readers", async () => {
    const filter = makeFilterTransport();
    await renderWithProviders(
      <EventHubContent
        event={buildEvent()}
        transport={makeTransport({ comments, permissions: [] })}
        filterTransport={filter}
      />,
    );
    const label = await screen.findByTestId("comment-pinned-pinned");
    expect(within(label).getByText("Pinned by Bumelerze")).toBeTruthy();
    expect(within(label).getByTestId("role-mark-official")).toBeTruthy();
    expect(screen.queryByTestId("pin-new")).toBeNull();
    expect(screen.queryByTestId("unpin-pinned")).toBeNull();
    expect(screen.queryByTestId("hub-surge-note")).toBeNull();
  });

  it("lets a hubs.feature holder pin and unpin", async () => {
    const filter = makeFilterTransport();
    await renderWithProviders(
      <EventHubContent
        event={buildEvent()}
        transport={makeTransport({ comments, permissions: ["hubs.feature"] })}
        filterTransport={filter}
      />,
    );
    await fireEvent.press(await screen.findByTestId("pin-new"));
    await waitFor(() => expect(filter.pinComment).toHaveBeenCalledWith("new"));
    await fireEvent.press(screen.getByTestId("unpin-pinned"));
    await waitFor(() => expect(filter.unpinComment).toHaveBeenCalledWith("pinned"));
  });

  it("explains busy-time review above the composer while it is on", async () => {
    await renderWithProviders(
      <EventHubContent
        event={buildEvent()}
        transport={makeTransport({ comments: [] })}
        filterTransport={makeFilterTransport({ surgeActive: true })}
      />,
    );
    expect(await screen.findByTestId("hub-surge-note")).toBeTruthy();
    expect(
      screen.getByText(
        "Busy time: comments from new accounts are reviewed before they appear.",
      ),
    ).toBeTruthy();
  });

  it("says the busy-time note in Sorani too", async () => {
    await i18n.changeLanguage("ckb");
    await renderWithProviders(
      <EventHubContent
        event={buildEvent()}
        transport={makeTransport({ comments: [] })}
        filterTransport={makeFilterTransport({ surgeActive: true })}
      />,
    );
    expect(await screen.findByText(i18n.t("eventHub.composer.surgeNote"))).toBeTruthy();
  });
});

describe("what does this mark mean", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("opens an explanation with who verified it, and closes", async () => {
    await renderWithProviders(
      <RoleMark roles={[{ role: "seismologist", orgName: null }]} explain />,
    );
    await fireEvent.press(
      screen.getByLabelText("Seismologist. What does this mark mean?"),
    );
    expect(screen.getByTestId("role-info-sheet")).toBeTruthy();
    expect(screen.getByTestId("role-info-meaning").props.children).toBe(
      "This person works in seismology, the science of earthquakes.",
    );
    expect(screen.getByTestId("role-info-verified").props.children).toBe(
      "The Bumelerze team checked this person's background before giving the mark.",
    );
    expect(screen.getByTestId("role-info-note")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("role-info-close"));
    expect(screen.queryByTestId("role-info-sheet")).toBeNull();
  });

  it("names a partner organisation", async () => {
    await renderWithProviders(
      <RoleMark roles={[{ role: "partner", orgName: "KRSO" }]} explain />,
    );
    await fireEvent.press(screen.getByTestId("role-mark-button-partner"));
    expect(screen.getByTestId("role-info-meaning").props.children).toBe(
      "KRSO is an organisation that works with Bumelerze.",
    );
  });

  it("says the official account is the app's own, without the 'not an endorsement' note", async () => {
    await renderWithProviders(
      <RoleMark roles={[{ role: "official", orgName: null }]} explain />,
    );
    await fireEvent.press(screen.getByTestId("role-mark-button-official"));
    expect(screen.getByTestId("role-info-verified").props.children).toBe(
      "It is the app's own account, run by the Bumelerze team.",
    );
    expect(screen.queryByTestId("role-info-note")).toBeNull();
  });

  it("is a plain image without `explain` (rows that are one big button)", async () => {
    await renderWithProviders(
      <RoleMark roles={[{ role: "moderator", orgName: null }]} />,
    );
    expect(screen.queryByTestId("role-mark-button-moderator")).toBeNull();
    expect(screen.getByLabelText("Moderator")).toBeTruthy();
  });

  it.each(["ckb", "kmr", "ar"])("reads in %s", async (lang) => {
    await i18n.changeLanguage(lang);
    await renderWithProviders(
      <RoleMark roles={[{ role: "engineer", orgName: null }]} explain />,
    );
    await fireEvent.press(screen.getByTestId("role-mark-button-engineer"));
    const meaning = i18n.t("eventHub.roleInfo.meaning.engineer");
    expect(screen.getByTestId("role-info-meaning").props.children).toBe(meaning);
    expect(meaning).not.toBe(
      "This person is an engineer, for example in buildings or structures.",
    );
  });
});
