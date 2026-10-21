import { act, cleanup, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useTabBarStore } from "../store";
import { useFloatingBottomOffset } from "../use-floating-bottom";

function Probe() {
  return <Text testID="offset">{String(useFloatingBottomOffset(16))}</Text>;
}

function renderWithBottomInset(bottom: number) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 402, height: 874 },
        insets: { top: 0, left: 0, right: 0, bottom },
      }}
    >
      <Probe />
    </SafeAreaProvider>,
  );
}

describe("useFloatingBottomOffset", () => {
  afterEach(() => {
    cleanup();
    useTabBarStore.setState({ hidden: false, inLayout: true });
  });

  it("is just the gap while the tab bar takes its strip (the bar already holds the home-indicator inset)", async () => {
    useTabBarStore.setState({ hidden: false, inLayout: true });
    await renderWithBottomInset(34);
    expect(screen.getByTestId("offset").props.children).toBe("16");
  });

  it("adds the home-indicator inset once the tab bar has slid away", async () => {
    useTabBarStore.setState({ hidden: true, inLayout: false });
    await renderWithBottomInset(34);
    expect(screen.getByTestId("offset").props.children).toBe("50");
  });

  it("drops the inset again only when the bar has finished sliding back in", async () => {
    useTabBarStore.setState({ hidden: true, inLayout: false });
    await renderWithBottomInset(34);
    await act(async () => {
      useTabBarStore.getState().setHidden(false);
    });
    // Mid-slide: the bar is not in the layout yet.
    expect(screen.getByTestId("offset").props.children).toBe("50");
    await act(async () => {
      useTabBarStore.getState().settle();
    });
    expect(screen.getByTestId("offset").props.children).toBe("16");
  });

  it("is the gap either way without an inset (a browser tab)", async () => {
    useTabBarStore.setState({ hidden: true, inLayout: false });
    await renderWithBottomInset(0);
    expect(screen.getByTestId("offset").props.children).toBe("16");
  });
});
