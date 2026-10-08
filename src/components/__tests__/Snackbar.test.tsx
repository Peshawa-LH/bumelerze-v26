import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { useEffect } from "react";
import { AccessibilityInfo, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { useUndoToast } from "@/features/undo/use-undo-toast";

import {
  SNACKBAR_ADMIN_MS,
  SNACKBAR_MS,
  SnackbarProvider,
  TAB_BAR_CONTENT_HEIGHT,
  useSnackbar,
  type SnackbarApi,
} from "../Snackbar";

const metrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 20 },
};

/** The style of the first rendered node positioned absolutely (the host). */
function flattenedStyleOfAbsoluteNode(node: unknown): Record<string, unknown> {
  const stack = [node].flat() as { props?: { style?: unknown }; children?: unknown[] }[];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || typeof current !== "object") {
      continue;
    }
    const style = Object.assign({}, ...[current.props?.style].flat(4).filter(Boolean));
    if (style.position === "absolute") {
      return style;
    }
    stack.push(...((current.children ?? []) as typeof stack));
  }
  return {};
}

/** The hooks' values, handed to the test after each render. */
const handles = {} as { api: SnackbarApi; toast: ReturnType<typeof useUndoToast> };
const api: SnackbarApi = {
  show: (options) => handles.api.show(options),
  dismiss: () => handles.api.dismiss(),
};
const toast: ReturnType<typeof useUndoToast> = (input) => handles.toast(input);

function Capture() {
  const value = useSnackbar();
  useEffect(() => {
    handles.api = value;
  }, [value]);
  return <Text>screen</Text>;
}

function CaptureToast() {
  const value = useUndoToast();
  useEffect(() => {
    handles.toast = value;
  }, [value]);
  return <Text>screen</Text>;
}

async function renderHost(bottomOffset?: number) {
  return await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SnackbarProvider {...(bottomOffset !== undefined ? { bottomOffset } : {})}>
        <Capture />
        <CaptureToast />
      </SnackbarProvider>
    </SafeAreaProvider>,
  );
}

describe("Snackbar", () => {
  let announce: jest.SpyInstance;
  beforeEach(async () => {
    jest.useFakeTimers();
    announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });
  afterEach(() => {
    cleanup();
    announce.mockRestore();
    jest.useRealTimers();
  });

  it("shows nothing until asked, and nothing happens without a provider", async () => {
    await renderHost();
    expect(screen.queryByTestId("snackbar")).toBeNull();
    // the default context is a harmless no-op
    const outside = await render(<Text>x</Text>);
    expect(outside).toBeTruthy();
  });

  it("shows the message with an Undo button, announces it, and closes after 8 s", async () => {
    await renderHost();
    await act(async () =>
      api.show({ message: "Comment deleted", actionLabel: "Undo", onAction: jest.fn() }),
    );
    expect(screen.getByTestId("snackbar-message")).toHaveTextContent("Comment deleted");
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(announce).toHaveBeenCalledWith("Comment deleted");
    expect(SNACKBAR_MS).toBe(8000);

    await act(async () => jest.advanceTimersByTime(SNACKBAR_MS - 1));
    expect(screen.getByTestId("snackbar")).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(1));
    expect(screen.queryByTestId("snackbar")).toBeNull();
  });

  it("is an alert in a polite live region for screen readers", async () => {
    await renderHost();
    await act(async () => api.show({ message: "Done" }));
    const bar = screen.getByTestId("snackbar");
    expect(bar.props.accessibilityRole).toBe("alert");
    expect(bar.props.accessibilityLiveRegion).toBe("polite");
  });

  it("calls the action once, then closes at once", async () => {
    const onAction = jest.fn(async () => undefined);
    await renderHost();
    await act(async () => api.show({ message: "Gone", actionLabel: "Undo", onAction }));
    await fireEvent.press(screen.getByTestId("snackbar-action"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("snackbar")).toBeNull();
    await act(async () => jest.advanceTimersByTime(20_000));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("a plain notice has no button", async () => {
    await renderHost();
    await act(async () => api.show({ message: "Restored" }));
    expect(screen.queryByTestId("snackbar-action")).toBeNull();
  });

  it("a newer snackbar replaces the older one and restarts the clock", async () => {
    await renderHost();
    await act(async () => api.show({ message: "First" }));
    await act(async () => jest.advanceTimersByTime(6000));
    await act(async () => api.show({ message: "Second" }));
    expect(screen.getByTestId("snackbar-message")).toHaveTextContent("Second");
    await act(async () => jest.advanceTimersByTime(6000));
    expect(screen.getByTestId("snackbar")).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(2000));
    expect(screen.queryByTestId("snackbar")).toBeNull();
  });

  it("honours a custom duration", async () => {
    await renderHost();
    await act(async () => api.show({ message: "Long", durationMs: 1500 }));
    await act(async () => jest.advanceTimersByTime(1500));
    expect(screen.queryByTestId("snackbar")).toBeNull();
  });

  it("tells the person when the Undo itself fails", async () => {
    await renderHost();
    await act(async () =>
      api.show({
        message: "Gone",
        actionLabel: "Undo",
        onAction: async () => Promise.reject(new Error("expired")),
      }),
    );
    await fireEvent.press(screen.getByTestId("snackbar-action"));
    expect(await screen.findByText("Couldn't undo. It may be too late.")).toBeTruthy();
    expect(screen.queryByTestId("snackbar-action")).toBeNull();
  });

  it("sits above the safe area and the tab bar it is given", async () => {
    await renderHost(TAB_BAR_CONTENT_HEIGHT);
    await act(async () => api.show({ message: "Up" }));
    const style = flattenedStyleOfAbsoluteNode(screen.toJSON());
    // 20 (home indicator) + 58 (tab bar) + 12 (gap)
    expect(style.bottom).toBe(20 + TAB_BAR_CONTENT_HEIGHT + 12);
    expect(style.position).toBe("absolute");
  });

  describe("useUndoToast", () => {
    it("shows the message with a translated Undo, 8 s for people and 10 s for admins", async () => {
      await renderHost();
      const restore = jest.fn(async () => undefined);
      await act(async () => toast({ message: "Post deleted", restore }));
      expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
      await fireEvent.press(screen.getByTestId("snackbar-action"));
      expect(restore).toHaveBeenCalledTimes(1);

      await act(async () => toast({ message: "Comment hidden", restore, admin: true }));
      expect(SNACKBAR_ADMIN_MS).toBe(10_000);
      await act(async () => jest.advanceTimersByTime(SNACKBAR_MS + 500));
      expect(screen.getByTestId("snackbar")).toBeTruthy();
      await act(async () => jest.advanceTimersByTime(SNACKBAR_ADMIN_MS - SNACKBAR_MS));
      expect(screen.queryByTestId("snackbar")).toBeNull();
    });

    it("words Undo in Sorani, Kurmanji and Arabic", async () => {
      await renderHost();
      for (const [lang, undo] of [
        ["ckb", "گەڕاندنەوە"],
        ["kmr", "Vegerîne"],
        ["ar", "تراجع"],
      ] as const) {
        await act(async () => {
          await i18n.changeLanguage(lang);
        });
        await act(async () => toast({ message: "x", restore: async () => undefined }));
        expect(screen.getByTestId("snackbar-action")).toHaveTextContent(undo);
      }
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    });
  });
});
