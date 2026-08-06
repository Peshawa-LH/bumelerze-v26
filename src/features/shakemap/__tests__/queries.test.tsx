import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import { fetchIntensityContours } from "../contours";
import { useShakeMap } from "../queries";
import { fetchShakeMapProduct } from "../usgs-products";
import type { IntensityContourSet, ShakeMapProduct } from "../types";

jest.mock("../usgs-products", () => ({
  fetchShakeMapProduct: jest.fn(),
}));
jest.mock("../contours", () => ({
  fetchIntensityContours: jest.fn(),
}));

const mockedFetchProduct = fetchShakeMapProduct as jest.MockedFunction<
  typeof fetchShakeMapProduct
>;
const mockedFetchContours = fetchIntensityContours as jest.MockedFunction<
  typeof fetchIntensityContours
>;

const FAKE_PRODUCT: ShakeMapProduct = {
  network: "ATLAS",
  version: 1,
  updateTime: 1594400092790,
  contoursUrl: "https://example.com/cont_mi.json",
  infoUrl: null,
};

const FAKE_CONTOURS: IntensityContourSet = {
  levels: [
    {
      value: 6,
      level: 6,
      rings: [
        {
          points: [
            [45, 35],
            [45.1, 35.1],
            [45.2, 35.2],
          ],
        },
      ],
    },
  ],
  skippedCount: 0,
};

let currentClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  // gcTime: 0 so no query lingers on a real setTimeout after a test ends
  // (React Query's cache-eviction timer would otherwise keep the Jest
  // process alive past the run — "Jest did not exit" hang).
  currentClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={currentClient}>{children}</QueryClientProvider>;
}

describe("useShakeMap", () => {
  beforeEach(() => {
    mockedFetchProduct.mockReset();
    mockedFetchContours.mockReset();
  });

  afterEach(() => {
    currentClient?.clear();
  });

  it("reports loading before the query settles", async () => {
    let resolveProduct: ((value: ShakeMapProduct | null) => void) | undefined;
    mockedFetchProduct.mockReturnValue(
      new Promise((resolve) => {
        resolveProduct = resolve;
      }),
    );
    const { result, unmount } = await renderHook(() => useShakeMap("us2000bmcg", true), {
      wrapper,
    });

    expect(result.current.status).toBe("loading");
    resolveProduct?.(null); // let the pending fetch settle so nothing lingers
    unmount();
  });

  it("reports loading (not fetching) while disabled, and never calls fetch", async () => {
    const { result, unmount } = await renderHook(() => useShakeMap("us2000bmcg", false), {
      wrapper,
    });

    expect(result.current.status).toBe("loading");
    expect(mockedFetchProduct).not.toHaveBeenCalled();
    unmount();
  });

  it("resolves to ready with both product and contours when a ShakeMap exists", async () => {
    mockedFetchProduct.mockResolvedValue(FAKE_PRODUCT);
    mockedFetchContours.mockResolvedValue(FAKE_CONTOURS);

    const { result, unmount } = await renderHook(() => useShakeMap("us2000bmcg", true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.product).toEqual(FAKE_PRODUCT);
    expect(result.current.contours).toEqual(FAKE_CONTOURS);
    expect(mockedFetchContours).toHaveBeenCalledWith(FAKE_PRODUCT.contoursUrl);
    unmount();
  });

  it("resolves to absent (not an error) for the common no-ShakeMap-product event", async () => {
    mockedFetchProduct.mockResolvedValue(null);

    const { result, unmount } = await renderHook(() => useShakeMap("us2000small", true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe("absent"));
    expect(result.current.product).toBeNull();
    expect(mockedFetchContours).not.toHaveBeenCalled();
    unmount();
  });

  it("resolves to unavailableOffline when the network request fails", async () => {
    mockedFetchProduct.mockRejectedValue(new Error("network down"));

    const { result, unmount } = await renderHook(() => useShakeMap("us2000bmcg", true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe("unavailableOffline"));
    expect(result.current.product).toBeNull();
    unmount();
  });
});
