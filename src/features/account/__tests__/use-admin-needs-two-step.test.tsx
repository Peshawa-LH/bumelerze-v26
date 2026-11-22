import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import {
  useAdminNeedsTwoStep,
  useAdminTwoStepState,
  useRefreshTwoStep,
} from "../use-two-step";

/**
 * Admin tools need two-step sign-in (security checklist A1.1, migration
 * 0076). From 0076 on `my_permissions()` is empty at aal1, so only
 * `my_admin_needs_two_step()` tells an admin why the tools are closed.
 * Who asks it, what an answer it cannot get means, and that a code (or a
 * sign-in) re-reads both answers so the tools open without a restart.
 */

let mockAccount: { status: string; userId: string | null } = {
  status: "account",
  userId: "u-admin",
};
jest.mock("../use-account", () => ({
  useAccount: () => mockAccount,
}));

type Res = { data: unknown; error: unknown };
const mockRpc = jest.fn<Promise<Res>, [string]>();
let mockFactors: { factor_type: string; status: string }[] = [];
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

const mockFetchPermissions = jest.fn<Promise<string[]>, []>();
jest.mock("@/features/eventhub/transport", () => ({
  ...jest.requireActual("@/features/eventhub/transport"),
  SupabaseEventHubTransport: {
    fetchMyPermissions: () => mockFetchPermissions(),
    fetchRoles: async () => ({}),
  },
}));

const NEEDS_RPC = "my_admin_needs_two_step";
const VERIFIED = { factor_type: "totp", status: "verified" };

function needsCalls(): number {
  return mockRpc.mock.calls.filter(([name]) => name === NEEDS_RPC).length;
}

const clients: QueryClient[] = [];
async function mountHook<T>(hook: () => T) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return await renderHook(hook, { wrapper });
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = { status: "account", userId: "u-admin" };
  mockFactors = [];
  mockFetchPermissions.mockResolvedValue([]);
  mockRpc.mockResolvedValue({ data: false, error: null });
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe("useAdminNeedsTwoStep", () => {
  it("an admin at aal1 (no permissions yet): asks once and says the tools wait", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const { result } = await mountHook(() => useAdminNeedsTwoStep());
    await waitFor(() => expect(result.current.needed).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(needsCalls()).toBe(1);
  });

  it("waits for the permissions before asking", async () => {
    let resolvePermissions: (value: string[]) => void = () => undefined;
    mockFetchPermissions.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolvePermissions = resolve;
      }),
    );
    const { result } = await mountHook(() => useAdminNeedsTwoStep());
    await settle();
    expect(needsCalls()).toBe(0);
    expect(result.current).toEqual({ needed: false, isLoading: false });
    await act(async () => {
      resolvePermissions([]);
    });
    await waitFor(() => expect(needsCalls()).toBe(1));
  });

  it("is 'still asking' between the permissions and the answer", async () => {
    mockRpc.mockReturnValue(new Promise<Res>(() => undefined));
    const { result } = await mountHook(() => useAdminNeedsTwoStep());
    await waitFor(() => expect(needsCalls()).toBe(1));
    expect(result.current).toEqual({ needed: false, isLoading: true });
  });

  it("never asks for an account that already has admin tools (aal2)", async () => {
    mockFetchPermissions.mockResolvedValue(["comments.moderate", "people.view"]);
    const { result } = await mountHook(() => useAdminNeedsTwoStep());
    await settle();
    await settle();
    expect(mockFetchPermissions).toHaveBeenCalled();
    expect(needsCalls()).toBe(0);
    expect(result.current).toEqual({ needed: false, isLoading: false });
  });

  it.each(["anonymous", "loading", "unconfigured"])(
    "never asks for a guest or before sign-in (%s)",
    async (status) => {
      mockAccount = { status, userId: status === "anonymous" ? "anon-1" : null };
      const { result } = await mountHook(() => useAdminNeedsTwoStep());
      await settle();
      expect(mockRpc).not.toHaveBeenCalled();
      expect(mockFetchPermissions).not.toHaveBeenCalled();
      expect(result.current).toEqual({ needed: false, isLoading: false });
    },
  );

  it.each(["PGRST202", "42883"])(
    "[before 0076] a missing function (%s) means no, and nothing waits",
    async (code) => {
      mockRpc.mockResolvedValue({ data: null, error: { code, message: "missing" } });
      const { result } = await mountHook(() => useAdminNeedsTwoStep());
      await waitFor(() => expect(needsCalls()).toBe(1));
      await settle();
      expect(result.current).toEqual({ needed: false, isLoading: false });
    },
  );

  it("offline: says no after one retry instead of waiting for a connection", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    const { result } = await mountHook(() => useAdminNeedsTwoStep());
    await waitFor(() => expect(needsCalls()).toBe(1));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 4000 });
    expect(result.current.needed).toBe(false);
    expect(needsCalls()).toBe(2);
  });
});

describe("useAdminTwoStepState (what an admin page shows)", () => {
  it("'turnOn' for an admin without two-step sign-in", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const { result } = await mountHook(() => useAdminTwoStepState());
    await waitFor(() => expect(result.current).toBe("turnOn"));
  });

  it("'enterCode' when two-step sign-in is on but this session gave no code", async () => {
    mockFactors = [VERIFIED];
    mockRpc.mockResolvedValue({ data: true, error: null });
    const { result } = await mountHook(() => useAdminTwoStepState());
    await waitFor(() => expect(result.current).toBe("enterCode"));
  });

  it("'loading' while the server is asked, never the tools or a 'not allowed'", async () => {
    mockRpc.mockReturnValue(new Promise<Res>(() => undefined));
    const { result } = await mountHook(() => useAdminTwoStepState());
    await waitFor(() => expect(needsCalls()).toBe(1));
    expect(result.current).toBe("loading");
  });

  it("'open' for an admin with tools, and for everyone the server says no to", async () => {
    mockFetchPermissions.mockResolvedValue(["stats.read"]);
    const admin = await mountHook(() => useAdminTwoStepState());
    await settle();
    expect(admin.result.current).toBe("open");
    mockFetchPermissions.mockResolvedValue([]);
    mockRpc.mockResolvedValue({ data: false, error: null });
    const plain = await mountHook(() => useAdminTwoStepState());
    await waitFor(() => expect(needsCalls()).toBe(1));
    await settle();
    expect(plain.result.current).toBe("open");
  });
});

describe("useRefreshTwoStep (after a code, turning it on or off, sign-in, sign-out)", () => {
  it("[A1.1] a code given: the permissions and the answer are read again, so the tools open without a restart", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const { result } = await mountHook(() => ({
      needs: useAdminNeedsTwoStep(),
      refresh: useRefreshTwoStep(),
    }));
    await waitFor(() => expect(result.current.needs.needed).toBe(true));
    expect(mockFetchPermissions).toHaveBeenCalledTimes(1);

    // The session is aal2 now: the server opens the tools.
    mockFetchPermissions.mockResolvedValue(["comments.moderate"]);
    mockRpc.mockResolvedValue({ data: false, error: null });
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(mockFetchPermissions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.needs.needed).toBe(false));
  });

  it("two-step sign-in turned off: the tools close and the card comes back", async () => {
    mockFetchPermissions.mockResolvedValue(["comments.moderate"]);
    const { result } = await mountHook(() => ({
      state: useAdminTwoStepState(),
      refresh: useRefreshTwoStep(),
    }));
    await settle();
    expect(result.current.state).toBe("open");
    expect(needsCalls()).toBe(0);

    // Supabase moves this session back to aal1 when the factor goes.
    mockFetchPermissions.mockResolvedValue([]);
    mockRpc.mockResolvedValue({ data: true, error: null });
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.state).toBe("turnOn"));
  });
});
