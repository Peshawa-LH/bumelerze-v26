import { renderHook } from "@testing-library/react-native";

import { useShakeMap } from "../queries";
import type { AtlasBundleEntry } from "../types";

// Self-contained factory (no outer-scope reference) — jest.mock factories
// run BEFORE any local `const` in this file is initialized (import
// statements, including the one that transitively pulls in "../atlas" via
// "../queries", are hoisted above everything else), so a factory that
// referenced an outer `mockEntry` const here would see it as `undefined`.
// `jest.requireMock` below reads the SAME object back out for assertions.
jest.mock("../atlas", () => ({
  ATLAS_INDEX: {
    us2000bmcg: {
      eventId: "us2000bmcg",
      producer: "bumelerze",
      version: 1,
      reviewStatus: "automatic",
      dataUsedSummaryKey: "dyfiConditioned",
      generatedAt: "2026-08-07T00:00:00.000Z",
      contours: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { value: 6, units: "ems" },
            geometry: {
              type: "MultiLineString",
              coordinates: [
                [
                  [45, 35],
                  [45.1, 35.1],
                  [45.2, 35.2],
                ],
              ],
            },
          },
        ],
      },
    },
  },
}));

function mockedEntry(): AtlasBundleEntry {
  return (
    jest.requireMock("../atlas") as { ATLAS_INDEX: Record<string, AtlasBundleEntry> }
  ).ATLAS_INDEX.us2000bmcg!;
}

describe("useShakeMap", () => {
  it("resolves to ready with the bundled product + parsed contours for a known atlas event", async () => {
    const { result } = await renderHook(() => useShakeMap("us2000bmcg", true));

    expect(result.current.status).toBe("ready");
    expect(result.current.product).toEqual(mockedEntry());
    expect(result.current.contours?.levels).toHaveLength(1);
    expect(result.current.contours?.levels[0]?.value).toBe(6);
  });

  it("resolves to absent (not an error) for an event with no bundled atlas product", async () => {
    const { result } = await renderHook(() => useShakeMap("us_not_in_atlas", true));

    expect(result.current.status).toBe("absent");
    expect(result.current.product).toBeNull();
    expect(result.current.contours).toBeNull();
  });

  it("resolves to absent while disabled, even for a known atlas event id", async () => {
    const { result } = await renderHook(() => useShakeMap("us2000bmcg", false));

    expect(result.current.status).toBe("absent");
  });

  it("resolves to absent for an empty event id", async () => {
    const { result } = await renderHook(() => useShakeMap("", true));

    expect(result.current.status).toBe("absent");
  });

  it("is referentially stable across re-renders with the same eventId/enabled (useMemo)", async () => {
    const { result, rerender } = await renderHook(
      ({ eventId, enabled }: { eventId: string; enabled: boolean }) =>
        useShakeMap(eventId, enabled),
      { initialProps: { eventId: "us2000bmcg", enabled: true } },
    );
    const first = result.current;
    rerender({ eventId: "us2000bmcg", enabled: true });
    expect(result.current).toBe(first);
  });
});
