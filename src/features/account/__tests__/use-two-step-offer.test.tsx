import {
  IsRestoringProvider,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { useTwoStepOffer } from "../use-two-step";

/**
 * Who is offered two-step sign-in: accounts with admin tools, and any
 * account that already has it on. The answer must wait for the permissions:
 * a "no" decided before they arrive sent an admin away from the setup
 * screen (found on the web build in Sorani, where React Query's `isLoading`
 * was still false while the saved cache was being read back). From
 * migration 0076 also admins whose tools wait for two-step sign-in (their
 * permissions are empty until a code is given).
 */

let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "u-admin",
};
jest.mock("../use-account", () => ({
  useAccount: () => mockAccount,
}));

let mockFactors: { factor_type: string; status: string }[] = [];
/** `my_admin_needs_two_step()` (migration 0076). */
const mockRpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string]>();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({
    rpc: (name: string) => mockRpc(name),
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
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: false, error: null });
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
    // An account with admin tools has given its code: nothing more to ask.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("[A1.1] offers it to an admin whose tools wait for two-step sign-in (0076)", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const { result } = await mount();
    await act(async () => {
      resolvePermissions([]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockRpc).toHaveBeenCalledWith("my_admin_needs_two_step");
    expect(result.current).toEqual({ offered: true, enabled: false, isLoading: false });
  });

  it("does not decide while the server is still asked whether the tools wait", async () => {
    mockRpc.mockReturnValue(new Promise(() => undefined));
    const { result } = await mount();
    await act(async () => {
      resolvePermissions([]);
    });
    await settle();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.offered).toBe(false);
  });

  it("[before 0076] a missing function offers nothing new", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "x" } });
    const { result } = await mount();
    await act(async () => {
      resolvePermissions([]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toEqual({ offered: false, enabled: false, isLoading: false });
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
    // Its permissions are empty, so the server is asked once (0076); no.
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.offered).toBe(false);
  });

  it("still offers it (to turn it off) when it is on without admin tools", async () => {
    mockFactors = [{ factor_type: "totp", status: "verified" }];
    const { result } = await mount();
    await act(async () => {
      resolvePermissions([]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.offered).toBe(true);
    expect(result.current.enabled).toBe(true);
  });

  it("never for a guest, and never 'loading' for one", async () => {
    mockAccount = { status: "anonymous", userId: "anon" };
    const { result } = await mount();
    await settle();
    expect(result.current).toEqual({ offered: false, enabled: false, isLoading: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
