import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import i18n from "@/i18n";

import { lazyScreenContent } from "../LazyScreenContent";

type Area = { Comp: () => React.JSX.Element };

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("lazyScreenContent", () => {
  let consoleError: jest.SpyInstance;
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    // React logs the error the boundary catches; the message is the point.
    consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it("uses the module directly when the loader is synchronous (iOS/Android, tests)", async () => {
    const Comp = () => <Text>LOADED</Text>;
    const Lazy = lazyScreenContent(() => ({ Comp }), (m: Area) => m.Comp);
    expect(Lazy).toBe(Comp);
  });

  it("shows the content once an asynchronous download resolves", async () => {
    const load = jest.fn(() => Promise.resolve({ Comp: () => <Text>LOADED</Text> }));
    const Lazy = lazyScreenContent(load, (m: Area) => m.Comp);
    await render(<Lazy />);
    await settle();
    expect(screen.getByText("LOADED")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("Retry after a failed first download starts a NEW download (review C-1)", async () => {
    let calls = 0;
    const load = jest.fn(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("Failed to fetch dynamically imported module"));
      }
      return Promise.resolve({ Comp: () => <Text>LOADED</Text> });
    });
    const Lazy = lazyScreenContent(load, (m: Area) => m.Comp);
    await render(<Lazy />);
    await settle();
    expect(screen.getByText("Couldn't load. Check your connection.")).toBeTruthy();

    await fireEvent.press(screen.getByText("Retry"));
    await settle();

    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByText("LOADED")).toBeTruthy();
  });

  it("keeps offering Retry while the download keeps failing", async () => {
    const load = jest.fn(() => Promise.reject(new Error("offline")));
    const Lazy = lazyScreenContent(load, (m: Area) => m.Comp);
    await render(<Lazy />);
    await settle();
    await fireEvent.press(screen.getByText("Retry"));
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});
