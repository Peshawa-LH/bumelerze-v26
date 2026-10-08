import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { View } from "react-native";

import { SnackbarProvider } from "@/components/Snackbar";
import i18n from "@/i18n";
import { DeleteHomeButton } from "../components/DeleteHomeButton";
import { MyHomeCard } from "../components/MyHomeCard";
import { useHomePhotoQueueStore } from "../photo-queue";
import {
  TAG,
  clearQueryClients,
  member,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
} from "../__fixtures__/testing";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: mockReplace,
    back: jest.fn(),
    canGoBack: () => true,
  }),
}));
const mockConfirm = jest.fn();
const mockMessage = jest.fn();
jest.mock("@/lib/dialogs", () => ({
  confirmDialog: (options: unknown) => mockConfirm(options),
  messageDialog: (title: string, message: string) => mockMessage(title, message),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "u-owner" }),
}));
jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  SupabaseHomeTransport: require("../__fixtures__/testing").mockTransport,
}));

function Screen() {
  return (
    <View>
      <MyHomeCard />
      <DeleteHomeButton tagId="tag-1" />
    </View>
  );
}

async function confirmDelete() {
  await act(async () => {
    fireEvent.press(screen.getByTestId("home-delete"));
  });
  await act(async () => {
    (mockConfirm.mock.calls[0]?.[0] as { onConfirm: () => void }).onConfirm();
  });
}

describe("Delete this home", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    useHomePhotoQueueStore.setState({ items: [] });
    mockTransport.fetchTags.mockResolvedValue([TAG]);
    mockTransport.fetchMemberships.mockResolvedValue([
      member("u-owner", { role: "owner" }),
    ]);
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(async () => {
    cleanup();
    await clearQueryClients();
  });

  it("moves the home to the trash: the My home card falls back to 'Tag my building', then goes to My account", async () => {
    await renderWithProviders(<Screen />);
    expect(await screen.findByTestId("home-card-tag-1")).toBeTruthy();
    // in the trash the tag is closed for every member (the owner included);
    // the membership row is still there, as on the server
    mockTransport.trashHome.mockImplementation(async () => {
      mockTransport.fetchTags.mockResolvedValue([]);
    });
    await confirmDelete();
    expect(mockTransport.trashHome).toHaveBeenCalledWith("tag-1");
    // nothing is deleted at once, photo files included
    expect(mockTransport.deleteHome).not.toHaveBeenCalled();
    // "home-tag" is also the "Tag another home" link while homes exist, so
    // wait for the deleted home's card to leave, then check the empty state.
    await waitFor(() => expect(screen.queryByTestId("home-card-tag-1")).toBeNull(), {
      timeout: 5000,
    });
    expect(screen.getByTestId("home-tag").props.accessibilityLabel).toBe(
      i18n.t("building.title"),
    );
    expect(screen.queryByText(i18n.t("building.section.tagAnother"))).toBeNull();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/my-data"));
    expect(mockMessage).not.toHaveBeenCalled();
  });

  it("forgets photos of that home still waiting in the upload queue", async () => {
    const item = (id: string, tagId: string) => ({
      id,
      tagId,
      uri: "file:///a.jpg",
      slot: "front" as const,
      caption: "",
      fileName: `front-${id}.jpg`,
      createdAt: 1,
      failures: 0,
      attempts: 0,
      nextRetryAt: null,
    });
    useHomePhotoQueueStore.setState({ items: [item("a", "tag-1"), item("b", "tag-2")] });
    await renderWithProviders(<Screen />);
    await screen.findByTestId("home-card-tag-1");
    await confirmDelete();
    await waitFor(() =>
      expect(useHomePhotoQueueStore.getState().items.map((i) => i.tagId)).toEqual([
        "tag-2",
      ]),
    );
  });

  it("offers Undo, which restores the home", async () => {
    await renderWithProviders(
      <SnackbarProvider>
        <Screen />
      </SnackbarProvider>,
    );
    await screen.findByTestId("home-card-tag-1");
    await confirmDelete();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/my-data"));
    expect(await screen.findByText("Home moved to the trash")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText("Undo"));
    });
    await waitFor(() => expect(mockTransport.restoreHome).toHaveBeenCalledWith("tag-1"));
    expect(mockMessage).not.toHaveBeenCalled();
  });

  it("on failure keeps the home, shows the error and does not navigate", async () => {
    mockTransport.trashHome.mockRejectedValue(new Error("boom"));
    await renderWithProviders(<Screen />);
    await screen.findByTestId("home-card-tag-1");
    await confirmDelete();
    expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
    expect(screen.getByTestId("home-card-tag-1")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
