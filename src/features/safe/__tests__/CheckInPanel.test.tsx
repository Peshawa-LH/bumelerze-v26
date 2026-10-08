import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { Share } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SnackbarProvider } from "@/components/Snackbar";
import type { EventRegistration } from "@/features/felt";
import i18n from "@/i18n";

import { CheckInPanel } from "../components/CheckInPanel";
import { __resetCheckInQueueForTests, useCheckInStore } from "../queue";

let mockUuid = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `client-${++mockUuid}` }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "u1",
};
jest.mock("@/features/account/use-account", () => ({ useAccount: () => mockAccount }));
let mockHomes: { homes: unknown[] } | null = { homes: [{ tag: { tagId: "t1" } }] };
jest.mock("@/features/building/queries", () => ({
  useMyHomes: () => ({
    data: mockHomes,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
const mockCheckIn = jest.fn();
const mockRetract = jest.fn();
jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  SupabaseCheckInTransport: {
    resolveEvent: () => Promise.resolve("server-event"),
    checkIn: (input: unknown) => mockCheckIn(input),
    retract: (id: string) => mockRetract(id),
  },
}));

const EVENT: EventRegistration = {
  provider: "usgs",
  providerId: "us7000abcd",
  originTime: Date.now() - 60 * 60_000,
  lat: 35.3,
  lon: 46.1,
  depthKm: 10,
  magnitude: 5.1,
  magType: "mww",
  placeName: "Halabja",
};

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderPanel(props: Partial<Parameters<typeof CheckInPanel>[0]> = {}) {
  await act(async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <SnackbarProvider>
          <CheckInPanel event={EVENT} {...props} />
        </SnackbarProvider>
      </SafeAreaProvider>,
    );
  });
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

beforeEach(async () => {
  __resetCheckInQueueForTests();
  mockAccount = { status: "account", userId: "u1" };
  mockHomes = { homes: [{ tag: { tagId: "t1" } }] };
  mockCheckIn.mockReset().mockResolvedValue({ outcome: "sent" });
  mockRetract.mockReset().mockResolvedValue(true);
  mockPush.mockReset();
  await i18n.changeLanguage("en");
});
afterEach(() => cleanup());

describe("CheckInPanel", () => {
  it("one tap: saved on the phone, Undo offered, then 'Your family can see it'", async () => {
    let release: (v: unknown) => void = () => undefined;
    mockCheckIn.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    await renderPanel();
    expect(screen.getByText("Are you safe?")).toBeTruthy();
    expect(
      screen.getByText("Bumelerze cannot send rescue teams or any help."),
    ).toBeTruthy();
    await press("im-safe-button");
    expect(useCheckInStore.getState().items).toHaveLength(1);
    expect(screen.getByTestId("im-safe-status")).toHaveTextContent(
      "Saved on your phone. It will be sent when there is signal.",
    );
    expect(screen.getByTestId("snackbar-action")).toHaveTextContent("Undo");
    // No "sent" wording before the server says so.
    expect(screen.queryByText("Your family can see that you are safe.")).toBeNull();
    await act(async () => {
      release({ outcome: "sent" });
    });
    expect(screen.getByTestId("im-safe-status")).toHaveTextContent(
      "Your family can see that you are safe.",
    );
    expect(screen.queryByTestId("im-safe-button")).toBeNull();
  });

  it("Undo takes it back and the button returns", async () => {
    await renderPanel();
    await press("im-safe-button");
    await act(async () => {
      await Promise.resolve();
    });
    const id = useCheckInStore.getState().items[0]?.clientId;
    await press("snackbar-action");
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockRetract).toHaveBeenCalledWith(id);
    expect(useCheckInStore.getState().items).toHaveLength(0);
    expect(screen.getByTestId("im-safe-button")).toBeTruthy();
  });

  it("a guest gets the share sheet and no server row", async () => {
    mockAccount = { status: "anonymous", userId: "anon" };
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" });
    await renderPanel();
    await press("im-safe-button");
    expect(share).toHaveBeenCalledTimes(1);
    const message = (share.mock.calls[0]?.[0] as { message: string }).message;
    expect(message).toMatch(/^I'm safe after the earthquake at/);
    expect(message).not.toMatch(/Halabja|35\.3|46\.1|http/);
    expect(useCheckInStore.getState().items).toHaveLength(0);
    expect(mockCheckIn).not.toHaveBeenCalled();
    expect(screen.getByTestId("im-safe-invite-guest")).toBeTruthy();
    await press("im-safe-create-account");
    expect(mockPush).toHaveBeenCalledWith("/account/sign-in");
    share.mockRestore();
  });

  it("an account without a home: share sheet and 'Join a home'", async () => {
    mockHomes = { homes: [] };
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" });
    await renderPanel();
    await press("im-safe-button");
    expect(share).toHaveBeenCalledTimes(1);
    expect(useCheckInStore.getState().items).toHaveLength(0);
    await press("im-safe-join");
    expect(mockPush).toHaveBeenCalledWith("/home/join");
    share.mockRestore();
  });

  it("practice stores nothing and shares nothing", async () => {
    const share = jest.spyOn(Share, "share");
    await renderPanel({ event: null, practice: true });
    expect(screen.getByText("Practice a check-in")).toBeTruthy();
    await press("im-safe-button");
    expect(screen.getByText("Practice done. Nothing was sent.")).toBeTruthy();
    expect(useCheckInStore.getState().items).toHaveLength(0);
    expect(share).not.toHaveBeenCalled();
    expect(mockCheckIn).not.toHaveBeenCalled();
    share.mockRestore();
  });

  it("'Send a message instead' works next to the family check-in", async () => {
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" });
    await renderPanel();
    await press("im-safe-share");
    expect(share).toHaveBeenCalledTimes(1);
    share.mockRestore();
  });

  it("'Not now' answers the prompt", async () => {
    const onNotNow = jest.fn();
    await renderPanel({ onNotNow });
    await press("im-safe-not-now");
    expect(onNotNow).toHaveBeenCalled();
  });

  it("the big button is at least 64 dp tall and named for screen readers", async () => {
    await renderPanel();
    const button = screen.getByRole("button", { name: "I'm safe" });
    const style = [button.props.style]
      .flat(3)
      .reduce((a, b) => ({ ...a, ...(b ?? {}) }), {});
    expect(style.minHeight).toBeGreaterThanOrEqual(64);
  });

  it("speaks Sorani, right to left", async () => {
    await i18n.changeLanguage("ckb");
    await renderPanel();
    expect(screen.getByText("ئایا سەلامەتیت؟")).toBeTruthy();
    expect(screen.getByRole("button", { name: "من سەلامەتم" })).toBeTruthy();
  });
});
