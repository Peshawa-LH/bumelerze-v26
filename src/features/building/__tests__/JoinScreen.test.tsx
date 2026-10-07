import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { JoinScreen } from "../components/JoinScreen";
import { HomeError } from "../types";
import {
  clearQueryClients,
  mockTransport,
  renderWithProviders,
  resetMockTransport,
} from "../__fixtures__/testing";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string | string[]> = {};
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: jest.fn(),
    canGoBack: () => true,
  }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
let mockCanScan = true;
let mockScanText = "";
jest.mock("../components/QrScanner", () => ({
  canScanQr: () => mockCanScan,
  QrScanner: ({
    onScan,
    onCancel,
  }: {
    onScan: (text: string) => void;
    onCancel: () => void;
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
    const { Pressable: P } = require("react-native");
    return (
      <>
        <P testID="mock-scan-read" onPress={() => onScan(mockScanText)} />
        <P testID="mock-scan-cancel" onPress={onCancel} />
      </>
    );
  },
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));
let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "u-9",
};
jest.mock("@/features/account/use-account", () => ({ useAccount: () => mockAccount }));
jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  SupabaseHomeTransport: require("../__fixtures__/testing").mockTransport,
}));

async function type(testID: string, text: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(testID), text);
  });
}

async function submit() {
  await act(async () => {
    fireEvent.press(screen.getByTestId("join-submit"));
  });
}

function submitDisabled(): boolean {
  return screen.getByTestId("join-submit").props.accessibilityState?.disabled === true;
}

describe("Join a home", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMockTransport();
    mockParams = {};
    mockCanScan = true;
    mockScanText = "";
    mockAccount = { status: "account", userId: "u-9" };
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(async () => {
    cleanup();
    await clearQueryClients();
  });

  it("an anonymous user sees the account card, not the form", async () => {
    mockAccount = { status: "anonymous", userId: "a1" };
    await renderWithProviders(<JoinScreen />);
    expect(screen.getByText("Create an account to join a home.")).toBeTruthy();
    expect(screen.queryByText("Create an account to tag your home.")).toBeNull();
    expect(screen.queryByTestId("join-code")).toBeNull();
  });

  it("needs a valid code and key before it can be sent", async () => {
    await renderWithProviders(<JoinScreen />);
    expect(submitDisabled()).toBe(true);
    await type("join-code", "BMH-7K3Q9P");
    expect(submitDisabled()).toBe(true);
    await type("join-key", "ABCD");
    expect(submitDisabled()).toBe(true);
    await type("join-key", "ABCD2345");
    expect(submitDisabled()).toBe(false);
  });

  it("sends the cleaned code and key and then waits for the owner", async () => {
    mockTransport.requestJoin.mockResolvedValue({ tagId: "tag-1", status: "pending" });
    await renderWithProviders(<JoinScreen />);
    await type("join-code", " bmh 7k3q9p ");
    await type("join-key", "abcd-2345");
    await submit();
    expect(mockTransport.requestJoin).toHaveBeenCalledWith("BMH-7K3Q9P", "ABCD2345");
    expect(await screen.findByText("Waiting for the owner to approve.")).toBeTruthy();
    expect(screen.getByText("Request sent")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("join-done"));
    });
    expect(mockReplace).toHaveBeenCalledWith("/my-data");
  });

  it("opens the report straight away when already a member", async () => {
    mockTransport.requestJoin.mockResolvedValue({ tagId: "tag-1", status: "approved" });
    await renderWithProviders(<JoinScreen />);
    await type("join-code", "BMH-7K3Q9P");
    await type("join-key", "ABCD2345");
    await submit();
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/home/[tagId]/report",
      params: { tagId: "tag-1" },
    });
  });

  it("a wrong code or key gives a short message and stays on the form", async () => {
    mockTransport.requestJoin.mockRejectedValue(new HomeError("wrong_code"));
    await renderWithProviders(<JoinScreen />);
    await type("join-code", "BMH-7K3Q9P");
    await type("join-key", "ABCD2345");
    await submit();
    expect(await screen.findByText("The code or key is wrong.")).toBeTruthy();
    expect(screen.getByTestId("join-code")).toBeTruthy();
    expect(screen.queryByText("Request sent")).toBeNull();
  });

  it("too many tries says to wait", async () => {
    mockTransport.requestJoin.mockRejectedValue(new HomeError("join_limit"));
    await renderWithProviders(<JoinScreen />);
    await type("join-code", "BMH-7K3Q9P");
    await type("join-key", "ABCD2345");
    await submit();
    expect(await screen.findByText("Too many tries. Try again in an hour.")).toBeTruthy();
  });

  it("needing an account shows the account message", async () => {
    mockTransport.requestJoin.mockRejectedValue(new HomeError("need_account"));
    await renderWithProviders(<JoinScreen />);
    await type("join-code", "BMH-7K3Q9P");
    await type("join-key", "ABCD2345");
    await submit();
    expect(await screen.findByText("Please create an account first.")).toBeTruthy();
  });

  it("the code and key fields are left-to-right Latin input", async () => {
    await renderWithProviders(<JoinScreen />);
    const code = screen.getByTestId("join-code");
    const style = Object.assign({}, ...[code.props.style].flat(Infinity).filter(Boolean));
    expect(style.writingDirection).toBe("ltr");
    expect(style.textAlign).toBe("left");
    expect(code.props.autoCapitalize).toBe("characters");
  });

  it("renders in Kurmanji without raw keys", async () => {
    await i18n.changeLanguage("kmr");
    await renderWithProviders(<JoinScreen />);
    expect(screen.getByText("Koda malê")).toBeTruthy();
    expect(screen.getByText("Mifteya nepenî")).toBeTruthy();
    expect(screen.queryByText(/building\.[a-z]/i)).toBeNull();
  });

  describe("invite link and QR scan", () => {
    it("opening the invite link pre-fills the code and key but does not send", async () => {
      mockParams = { code: "BMH-7K3Q9P", key: "ABCD2345" };
      await renderWithProviders(<JoinScreen />);
      expect(screen.getByTestId("join-code").props.value).toBe("BMH-7K3Q9P");
      expect(screen.getByTestId("join-key").props.value).toBe("ABCD2345");
      expect(submitDisabled()).toBe(false);
      expect(mockTransport.requestJoin).not.toHaveBeenCalled();
    });

    it("an anonymous user opening the link is asked to sign in first; the link params stay for the return", async () => {
      mockParams = { code: "BMH-7K3Q9P", key: "ABCD2345" };
      mockAccount = { status: "anonymous", userId: "a1" };
      await renderWithProviders(<JoinScreen />);
      expect(screen.getByText("Create an account to join a home.")).toBeTruthy();
      expect(screen.queryByText("Create an account to tag your home.")).toBeNull();
      expect(screen.queryByTestId("join-code")).toBeNull();
      await act(async () => {
        fireEvent.press(screen.getByTestId("home-gate-sign-in"));
      });
      // Sign-in is pushed on top of this screen, so Back returns to the same
      // route with the same code and key.
      expect(mockPush).toHaveBeenCalledWith("/account/sign-in");
    });

    it("lowercase or spaced link values are cleaned the same as typed ones", async () => {
      mockParams = { code: "bmh-7k3q9p", key: "abcd2345" };
      mockTransport.requestJoin.mockResolvedValue({ tagId: "tag-1", status: "pending" });
      await renderWithProviders(<JoinScreen />);
      await submit();
      expect(mockTransport.requestJoin).toHaveBeenCalledWith("BMH-7K3Q9P", "ABCD2345");
    });

    it("offers 'Scan a code' where scanning works", async () => {
      await renderWithProviders(<JoinScreen />);
      expect(screen.getByTestId("join-scan")).toBeTruthy();
      expect(screen.getByText("Scan a code")).toBeTruthy();
    });

    it("hides 'Scan a code' where it does not work; typing stays", async () => {
      mockCanScan = false;
      await renderWithProviders(<JoinScreen />);
      expect(screen.queryByTestId("join-scan")).toBeNull();
      expect(screen.getByTestId("join-code")).toBeTruthy();
    });

    it("a scanned invite fills the fields; the owner still approves each join", async () => {
      mockScanText = "https://bumelerze.com/app/home/join?code=BMH-7K3Q9P&key=ABCD2345";
      await renderWithProviders(<JoinScreen />);
      await act(async () => {
        fireEvent.press(screen.getByTestId("join-scan"));
      });
      expect(screen.queryByTestId("join-code")).toBeNull();
      await act(async () => {
        fireEvent.press(screen.getByTestId("mock-scan-read"));
      });
      expect(screen.getByTestId("join-code").props.value).toBe("BMH-7K3Q9P");
      expect(screen.getByTestId("join-key").props.value).toBe("ABCD2345");
      expect(mockTransport.requestJoin).not.toHaveBeenCalled();
    });

    it("a QR that is not a Bumelerze invite says so and fills nothing", async () => {
      mockScanText = "https://example.com/?code=BMH-7K3Q9P&key=ABCD2345";
      await renderWithProviders(<JoinScreen />);
      await act(async () => {
        fireEvent.press(screen.getByTestId("join-scan"));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("mock-scan-read"));
      });
      expect(screen.getByText("This is not a Bumelerze home invite.")).toBeTruthy();
      expect(screen.getByTestId("join-code").props.value).toBe("");
    });

    it("cancelling the scan returns to the form", async () => {
      await renderWithProviders(<JoinScreen />);
      await act(async () => {
        fireEvent.press(screen.getByTestId("join-scan"));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("mock-scan-cancel"));
      });
      expect(screen.getByTestId("join-code")).toBeTruthy();
    });
  });
});
