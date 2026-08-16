/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — marker click/keyboard
 * activation and accessibility. See `map-web-creation.test.tsx`'s doc
 * comment for the jsdom-environment/mocking rationale.
 *
 * One `it()` block, not several: this combination (jsdom `document` +
 * `@testing-library/react-native`'s `act`/`waitFor` + a mocked dynamic
 * `import()`) was observed to stop flushing effects at all starting with
 * the SECOND full mount-and-settle cycle within one test file/environment,
 * for reasons not traced to any bug in `map.web.tsx` itself (isolated
 * single-mount tests, including this exact scenario run alone, always
 * pass). One render, several sequential (synchronous, already-mounted)
 * interactions against its markers avoids needing a second async settle.
 */
import {
  act,
  cleanup,
  render,
  waitFor,
  type RenderResult,
} from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  makeEvent,
  MockAttributionControl,
  MockMap,
  MockMarker,
  mockMarkerConstructorOptions,
  mockPush,
  mockSetWorkerUrl,
  mockUseRegionEvents,
  resetMapWebMocks,
  testSafeAreaMetrics,
} from "../__fixtures__/map-web-helpers";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    useRouter: () => ({ push: mockPush }),
  };
});

jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  return {
    ...actual,
    useRegionEvents: () => mockUseRegionEvents(),
  };
});

// `{ virtual: true }`: maplibre-gl ships ESM-only — see
// map-web-creation.test.tsx.
jest.mock(
  "maplibre-gl",
  () => ({
    Map: MockMap,
    Marker: MockMarker,
    AttributionControl: MockAttributionControl,
    setWorkerUrl: mockSetWorkerUrl,
  }),
  { virtual: true },
);

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import MapScreenWeb from "../(tabs)/map.web";

async function renderWithProviders(ui: ReactElement): Promise<RenderResult> {
  // `render` is async in this installed `@testing-library/react-native`
  // version (14.x) — must be awaited.
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

beforeEach(() => {
  resetMapWebMocks();
});

afterEach(() => {
  cleanup();
});

describe("MapScreenWeb interaction", () => {
  it("marker: click pushes the route, Enter matches click, other keys are ignored, and it's accessible", async () => {
    mockUseRegionEvents.mockReturnValue({ events: [makeEvent({ id: "us7000xyz" })] });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMarkerConstructorOptions).toHaveLength(1);
    });
    const marker = mockMarkerConstructorOptions[0];

    // Accessibility: role/label/tab-stop present on the marker element
    // itself — no separate render needed to check this.
    expect(marker?.element.getAttribute("role")).toBe("button");
    expect(marker?.element.getAttribute("aria-label")).toBeTruthy();
    expect(marker?.element.tabIndex).toBe(0);

    // A key that isn't Enter/Space does nothing.
    act(() => {
      marker!.element.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(mockPush).not.toHaveBeenCalled();

    // Enter activates it, matching click's behavior.
    act(() => {
      marker!.element.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(mockPush).toHaveBeenCalledWith("/event/us7000xyz");

    mockPush.mockClear();

    // Click does the same thing.
    act(() => {
      marker!.element.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(mockPush).toHaveBeenCalledWith("/event/us7000xyz");
  });
});
