import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { CommunityError } from "@/features/community/types";
import {
  makeTransport,
  renderWithProviders,
} from "@/features/eventhub/__fixtures__/testing";
import type { Permission } from "@/features/eventhub/types";
import i18n from "@/i18n";

import { LimitedAccountsContent } from "../components/LimitedAccountsContent";
import { adminRow, fakeTransport } from "../__fixtures__/testing";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "admin-1" }),
}));

const hub = makeTransport({ permissions: [] });
const MODERATOR: Permission[] = ["comments.moderate", "accounts.restrict"];
const OFFICIAL: Permission[] = [
  "comments.moderate",
  "accounts.restrict",
  "accounts.suspend",
];

async function render(
  permissions: Permission[],
  transport: ReturnType<typeof fakeTransport>,
) {
  hub.fetchMyPermissions.mockResolvedValue(permissions);
  await renderWithProviders(
    <LimitedAccountsContent transport={transport} hubTransport={hub} />,
  );
}

describe("Admin > Limited accounts", () => {
  beforeEach(async () => {
    mockPush.mockClear();
    hub.fetchMyPermissions.mockReset();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("lists a limit with who, what, why, until when and by whom", async () => {
    await render(
      MODERATOR,
      fakeTransport({ rows: [adminRow({ note: "see report 12" })] }),
    );
    expect(await screen.findByTestId("limited-name-r1")).toHaveTextContent("Dilan");
    expect(screen.getByTestId("limited-level-r1")).toHaveTextContent(
      "Restrict · Harassment",
    );
    expect(screen.getByTestId("limited-status-r1")).toHaveTextContent(/^Until /);
    expect(screen.getByText("By Mona")).toBeTruthy();
    expect(screen.getByTestId("limited-note-r1")).toHaveTextContent(
      "Note: see report 12",
    );
  });

  it("names a guest by the first characters of its id, never more", async () => {
    await render(
      MODERATOR,
      fakeTransport({
        rows: [adminRow({ userName: null, userUsername: null, isGuest: true })],
      }),
    );
    expect(await screen.findByTestId("limited-name-r1")).toHaveTextContent(
      "Guest 11111111",
    );
    expect(screen.queryByText(/555555555555/)).toBeNull();
  });

  it("marks a limit whose person asked for a review", async () => {
    await render(
      MODERATOR,
      fakeTransport({ rows: [adminRow({ appealRequestedAt: Date.now() - 1000 })] }),
    );
    expect(await screen.findByTestId("limited-appeal-r1")).toHaveTextContent(
      "Asked for review",
    );
  });

  it("Lift calls the server and confirms in a snackbar", async () => {
    const transport = fakeTransport({ rows: [adminRow()] });
    await render(MODERATOR, transport);
    await fireEvent.press(await screen.findByTestId("limited-lift-r1"));
    await waitFor(() => expect(transport.lift).toHaveBeenCalledWith("r1"));
    expect(await screen.findByTestId("snackbar-message")).toHaveTextContent(
      "Limit lifted",
    );
  });

  it("a moderator cannot lift a suspension; the official rank can", async () => {
    const rows = [adminRow({ id: "s1", level: "suspend", endsAt: null })];
    await render(MODERATOR, fakeTransport({ rows }));
    expect(await screen.findByTestId("limited-status-s1")).toHaveTextContent(
      "Until lifted",
    );
    expect(screen.queryByTestId("limited-lift-s1")).toBeNull();
    await cleanup();
    hub.fetchMyPermissions.mockReset();
    await render(OFFICIAL, fakeTransport({ rows }));
    expect(await screen.findByTestId("limited-lift-s1")).toBeTruthy();
  });

  it("an ended or lifted limit is history: no Lift, and it says how it ended", async () => {
    await render(
      OFFICIAL,
      fakeTransport({
        rows: [
          adminRow({ id: "a", active: false, endsAt: Date.now() - 1000 }),
          adminRow({
            id: "b",
            active: false,
            liftedAt: Date.now() - 500,
            liftedByName: "Bumelerze",
          }),
        ],
      }),
    );
    expect(await screen.findByTestId("limited-status-a")).toHaveTextContent("Ended");
    expect(screen.getByTestId("limited-status-b")).toHaveTextContent(
      "Lifted by Bumelerze",
    );
    expect(screen.queryByTestId(/^limited-lift-/)).toBeNull();
  });

  it("opens the person's profile", async () => {
    await render(MODERATOR, fakeTransport({ rows: [adminRow()] }));
    await fireEvent.press(await screen.findByTestId("limited-open-r1"));
    expect(mockPush).toHaveBeenCalledWith("/u/dilan.k");
  });

  it("says so when there are no limits", async () => {
    await render(MODERATOR, fakeTransport());
    expect(await screen.findByTestId("limited-empty")).toHaveTextContent(
      "No limits right now.",
    );
  });

  it("words a failed list and offers Retry", async () => {
    const transport = fakeTransport();
    transport.fetchAdminList.mockRejectedValueOnce(new CommunityError("network"));
    await render(MODERATOR, transport);
    expect(await screen.findByTestId("limited-error")).toHaveTextContent(
      "No connection. Try again.",
    );
    await fireEvent.press(screen.getByTestId("limited-retry"));
    expect(await screen.findByTestId("limited-empty")).toBeTruthy();
  });

  it("words a lift the server refused", async () => {
    const transport = fakeTransport({ rows: [adminRow()] });
    transport.lift.mockRejectedValueOnce(new CommunityError("forbidden"));
    await render(MODERATOR, transport);
    await fireEvent.press(await screen.findByTestId("limited-lift-r1"));
    expect(await screen.findByText("Not allowed.")).toBeTruthy();
  });

  it("shows nothing but 'not allowed' to someone without accounts.restrict", async () => {
    const transport = fakeTransport({ rows: [adminRow()] });
    await render(["comments.moderate"], transport);
    expect(await screen.findByTestId("limited-no-access")).toBeTruthy();
    expect(transport.fetchAdminList).not.toHaveBeenCalled();
  });

  it("reads in Kurmanji", async () => {
    await i18n.changeLanguage("kmr");
    await render(MODERATOR, fakeTransport({ rows: [adminRow()] }));
    expect(await screen.findByTestId("limited-level-r1")).toHaveTextContent(
      "Sînordarkirin · Tacîz",
    );
    expect(screen.getByText("Rake")).toBeTruthy();
  });
});
