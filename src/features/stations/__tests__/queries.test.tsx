import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import type { LiveStation, StationTrace, StationTraceTransport } from "../index";
import { useStationFreshness, useStationTrace } from "../queries";

function station(id: string, lastSeenAt: string | null): LiveStation {
  const [net, sta] = id.split(".") as [string, string];
  return {
    id,
    net,
    sta,
    name: id,
    channel: "HHZ",
    sps: 100,
    lat: 36,
    lon: 44,
    elevM: 0,
    service: "earthscope",
    country: "IQ",
    operator: "x",
    credit: "x",
    distanceKmFromErbil: 10,
    lastSeenAt,
  };
}

// The hooks poll; unmount them and drop their clients so no timer outlives
// a test (an open interval kept a lone run of this file from exiting).
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function newClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanups.push(() => client.clear());
  return client;
}

describe("useStationFreshness", () => {
  it("marks probed stations live and keeps the catalogue tier for the rest", async () => {
    const transport: StationTraceTransport = {
      probeRecent: async (s) => s.id === "MP.KIR1",
      fetchTrace: async () => null,
    };
    const client = newClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const stations = [
      station("MP.KIR1", null),
      station("MP.DHK1", null),
      station("KO.AKDM", new Date().toISOString()),
    ];
    const { result, unmount } = await renderHook(
      () => useStationFreshness(stations, transport),
      { wrapper },
    );
    cleanups.unshift(unmount);
    await waitFor(() => expect(result.current["MP.KIR1"]).toBe("live"));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(result.current["MP.DHK1"]).toBe("silent");
    expect(result.current["KO.AKDM"]).toBe("recent");
  });
});

describe("useStationTrace with a delayed-archive station", () => {
  function wrapperFor(client: QueryClient) {
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    return Wrapper;
  }
  const shake: LiveStation = {
    ...station("AM.R079D", null),
    loc: "00",
    channel: "EHZ",
    service: "raspberryshake",
  };
  function traceEndingAgo(id: string, agoMs: number): StationTrace {
    const endMs = Date.now() - agoMs;
    return {
      stationId: id,
      channel: "EHZ",
      sps: 100,
      startMs: endMs - 20,
      endMs,
      samples: [1, 2, 3],
    };
  }

  it("calls a Raspberry Shake 30 minutes behind live and reports the delay", async () => {
    const transport: StationTraceTransport = {
      probeRecent: async () => false,
      fetchTrace: async (s) => traceEndingAgo(s.id, 30 * 60_000),
    };
    const client = newClient();
    const { result, unmount } = await renderHook(
      () => useStationTrace(shake, transport),
      {
        wrapper: wrapperFor(client),
      },
    );
    cleanups.unshift(unmount);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(result.current.freshness).toBe("live");
    expect(Math.round((result.current.lagMs ?? 0) / 60_000)).toBe(30);
  });

  it("[regression guard] keeps 30 minutes behind as Delayed for the other services", async () => {
    // KOERI, not EarthScope: an EarthScope station would open the real
    // DataLink stream from inside the test.
    const cukt: LiveStation = { ...station("KO.CUKT", null), service: "koeri" };
    const transport: StationTraceTransport = {
      probeRecent: async () => false,
      fetchTrace: async (s) => traceEndingAgo(s.id, 30 * 60_000),
    };
    const client = newClient();
    const { result, unmount } = await renderHook(() => useStationTrace(cukt, transport), {
      wrapper: wrapperFor(client),
    });
    cleanups.unshift(unmount);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(result.current.freshness).toBe("recent");
  });

  it("hands the previous answer to the next poll, so only new data is asked for", async () => {
    const first = traceEndingAgo("AM.R079D", 30 * 60_000);
    const fetchTrace = jest.fn<
      ReturnType<StationTraceTransport["fetchTrace"]>,
      Parameters<StationTraceTransport["fetchTrace"]>
    >(async () => first);
    const transport: StationTraceTransport = {
      probeRecent: async () => false,
      fetchTrace,
    };
    const client = newClient();
    const { result, unmount } = await renderHook(
      () => useStationTrace(shake, transport),
      {
        wrapper: wrapperFor(client),
      },
    );
    cleanups.unshift(unmount);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(fetchTrace.mock.calls[0]?.[2]).toBeNull();
    await act(async () => {
      await client.refetchQueries({ queryKey: ["station-trace", "AM.R079D"] });
    });
    expect(fetchTrace).toHaveBeenCalledTimes(2);
    expect(fetchTrace.mock.calls[1]?.[2]).toEqual(first);
  });
});
