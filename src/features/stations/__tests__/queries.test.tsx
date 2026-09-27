import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import type { LiveStation, StationTraceTransport } from "../index";
import { useStationFreshness } from "../queries";

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

describe("useStationFreshness", () => {
  it("marks probed stations live and keeps the catalogue tier for the rest", async () => {
    const transport: StationTraceTransport = {
      probeRecent: async (s) => s.id === "MP.KIR1",
      fetchTrace: async () => null,
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const stations = [
      station("MP.KIR1", null),
      station("MP.DHK1", null),
      station("KO.AKDM", new Date().toISOString()),
    ];
    const { result } = await renderHook(() => useStationFreshness(stations, transport), {
      wrapper,
    });
    await waitFor(() => expect(result.current["MP.KIR1"]).toBe("live"));
    expect(result.current["MP.DHK1"]).toBe("silent");
    expect(result.current["KO.AKDM"]).toBe("recent");
  });
});
