import {
  IsRestoringProvider,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { useTwoStepOffer } from "../use-two-step";

/**
 * Who is offered two-step sign-in: accounts with admin tools, and any
 * account that already has it on. The answer must wait for the permissions:
 * a "no" decided before they arrive sent an admin away from the setup
 * screen (found on the web build in Sorani, where React Query's `isLoading`
 * was still false while the saved cache was being read back).
 */

let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "u-admin",
};
jest.mock("../use-account", () => ({
  useAccount: () => mockAccount,
}));

let mockFactors: { factor_type: string; status: string }[] = [];
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "u-admin", factors: mockFactors } } },
        error: null,
      }),
    },
  }),
}));

let resolvePermissions: (value: string[]) => void = () => undefined;
jest.mock("@/features/eventhub/transport", () => ({
  ...jest.requireActual("@/features/eventhub/transport"),
  SupabaseEventHubTransport: {
    fetchMyPermissions: () =>
      new Promise<string[]>((resolve) => {
        resolvePermissions = resolve;
      }),
    fetchRoles: async () => ({}),
  },
}));

const clients: QueryClient[] = [];
async function mount({ restoring = false }: { restoring?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>
    </QueryClientProvider>
  );
  return await renderHook(() => useTwoStepOffer(), { wrapper });
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useTwoStepOffer", () => {
  beforeEach(() => {
    mockAccount = { status: "account", userId: "u-admin" };
    mockFactors = [];
  });
  afterEach(() => {
    for (const client of clients.splice(0)) client.clear();
  });

  it("is still finding out until the permissions have arrived", async () => {
    const { result } = await mount();
    await settle();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.offered).toBe(false);
    await act(async () => {
      resolvePermissions(["comments.moderate"]);
    });
    await settle();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.offered).toBe(true);
    expect(result.current.enabled).toBe(false);
  });

  it("[regression] does not decide while the saved cache is being read back", async () => {
    // What PersistQueryClientProvider does at start on the web: queries wait
    // (not fetching), so React Query's isLoading is false.
    const { result } = await mount({ restoring: true });
    await settle();
    expect(result.current.isLoading).toBe(true);
  });

  it("offers nothing to an account without admin tools", async () => {
    const { result } = await mount();
    await act(async () => {
      resolvePermissions([]);
    });
    await settle();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.offered).toBe(false);
  });

  it("still offers it (to turn it off) when it is on without admin tools", async () => {
    mockFactors = [{ factor_type: "totp", status: "verified" }];
    const { result } = await mount();
    await act(async () => {
      resolvePermissions([]);
    });
    await settle();
    expect(result.current.offered).toBe(true);
    expect(result.current.enabled).toBe(true);
  });

  it("never for a guest, and never 'loading' for one", async () => {
    mockAccount = { status: "anonymous", userId: "anon" };
    const { result } = await mount();
    await settle();
    expect(result.current).toEqual({ offered: false, enabled: false, isLoading: false });
  });
});
