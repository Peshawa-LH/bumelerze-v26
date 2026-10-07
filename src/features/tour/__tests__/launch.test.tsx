import { renderHook } from "@testing-library/react-native";

import { useLaunchPendingTour, useTourLaunchStore } from "../launch";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("useLaunchPendingTour", () => {
  beforeEach(() => {
    mockPush.mockClear();
    useTourLaunchStore.setState({ pending: false });
  });

  it("does nothing when the tour was not asked for", async () => {
    await renderHook(() => useLaunchPendingTour(true));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("waits for the main stack, then opens the tour once", async () => {
    useTourLaunchStore.getState().request();
    const { rerender } = await renderHook(
      ({ active }: { active: boolean }) => useLaunchPendingTour(active),
      { initialProps: { active: false } },
    );
    expect(mockPush).not.toHaveBeenCalled();

    await rerender({ active: true });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/tour");
    expect(useTourLaunchStore.getState().pending).toBe(false);

    await rerender({ active: true });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
