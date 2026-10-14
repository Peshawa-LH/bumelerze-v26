import { act, cleanup, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import { renderWithProviders } from "@/features/eventhub/__fixtures__/testing";

import { OwnerList } from "../components/OwnerList";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({
    rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
  }),
}));
jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ status: "account", userId: "u1", profileLoaded: true }),
}));
jest.mock("@/features/eventhub/transport", () => ({
  ...jest.requireActual("@/features/eventhub/transport"),
  SupabaseEventHubTransport: {
    fetchMyPermissions: jest.fn().mockResolvedValue([]),
    fetchRoles: jest.fn().mockResolvedValue({}),
  },
}));

let mockHomes: unknown[] = [];
jest.mock("@/features/building", () => ({
  ...jest.requireActual("@/features/building"),
  useMyHomes: () => ({ data: { homes: mockHomes } }),
}));

function home(vcMostLikely: string, vcRange: string | null) {
  return {
    tag: { tagId: "t1", label: "Our house", kind: "house" },
    assessment: { vcMostLikely, vcRange },
    role: "owner",
  };
}

describe("OwnerList: the My home row", () => {
  beforeEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(cleanup);

  it("summarises one home with the most likely class and the pessimistic-optimistic span", async () => {
    mockHomes = [home("C", "B-D")];
    await renderWithProviders(<OwnerList />);
    await act(async () => undefined);
    expect(screen.getByText("VC C (B–D) · Our house")).toBeTruthy();
  });

  it("keeps the short form when all three classes are the same", async () => {
    mockHomes = [home("B", "B")];
    await renderWithProviders(<OwnerList />);
    await act(async () => undefined);
    expect(screen.getByText("VC B · Our house")).toBeTruthy();
  });
});
