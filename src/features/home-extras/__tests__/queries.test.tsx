import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { homeExtrasKeys, useHiddenEarthquakes, useHomeExtras } from "../queries";
import type { HomeExtras, HomeExtrasTransport } from "../transport";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
}));

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const answer: HomeExtras = {
  notice: null,
  pins: [],
  hidden: [
    {
      bumelerzeId: "bml2026x03",
      providerIds: ["us7000blst"],
      reasonKind: "removed",
      kept: null,
    },
  ],
};

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

describe("home extras on the device (migration 0085)", () => {
  afterEach(cleanup);

  it("fills in the hidden list for a copy saved by 26.5.0-26.5.1", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    // What an older app left in the saved cache: no `hidden` key.
    const notice = {
      id: "n1",
      kind: "info",
      texts: { en: "Hello" },
      startsAt: 0,
      endsAt: Date.now() + 3_600_000,
    };
    client.setQueryData(homeExtrasKeys.all, { notice, pins: [] });
    const transport: HomeExtrasTransport = {
      fetchHomeExtras: jest.fn(() => new Promise<HomeExtras>(() => undefined)),
    };
    const { result, unmount } = await renderHook(() => useHomeExtras(transport), {
      wrapper: wrapperFor(client),
    });
    expect(result.current.notice).toEqual(notice);
    expect(result.current.hidden).toEqual([]);
    await unmount();
    client.clear();
  });

  it("gives other screens the hidden list from the same read", async () => {
    const client = newClient();
    const transport: HomeExtrasTransport = {
      fetchHomeExtras: jest.fn(async () => answer),
    };
    const { result } = await renderHook(() => useHiddenEarthquakes(transport), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.byId.get("us7000blst")?.bumelerzeId).toBe("bml2026x03");
    expect(result.current.byId.get("bml2026x03")?.reasonKind).toBe("removed");
    expect(transport.fetchHomeExtras).toHaveBeenCalledTimes(1);
  });

  it("asks only when the copy is stale: a fresh one from Home is reused", async () => {
    const client = newClient();
    client.setQueryData(homeExtrasKeys.all, answer);
    const transport: HomeExtrasTransport = {
      fetchHomeExtras: jest.fn(async () => answer),
    };
    const { result } = await renderHook(() => useHiddenEarthquakes(transport), {
      wrapper: wrapperFor(client),
    });
    expect(result.current.size).toBe(1);
    expect(transport.fetchHomeExtras).not.toHaveBeenCalled();
  });
});
