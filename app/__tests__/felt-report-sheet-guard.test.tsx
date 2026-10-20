/**
 * The felt-report flow is an iOS sheet that a downward swipe closes. Mid-
 * report (after the first tap: damage, details, the questionnaire) the swipe
 * is off so answers are never lost to a stray swipe; the flow's own Close
 * leaves it, as on the web.
 */
import { render } from "@testing-library/react-native";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

const mockSetOptions = jest.fn();
let mockSegments: string[] = ["felt-report"];

jest.mock("expo-router", () => {
  function Stack({ children }: { children?: unknown }) {
    return children ?? null;
  }
  Stack.Screen = function Screen() {
    return null;
  };
  return {
    Stack,
    useNavigation: () => ({ setOptions: mockSetOptions }),
    useSegments: () => mockSegments,
  };
});

/* eslint-disable import/first -- after the mock above */
import Layout from "../felt-report/_layout";
/* eslint-enable import/first */

const METRICS = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 62, left: 0, right: 0, bottom: 34 },
};

function FeltReportLayout() {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <Layout />
    </SafeAreaProvider>
  );
}

describe("felt-report sheet (iOS)", () => {
  beforeEach(() => {
    mockSetOptions.mockClear();
  });

  it("keeps the swipe-to-close on the first window, where nothing is chosen yet", async () => {
    mockSegments = ["felt-report"];
    await render(<FeltReportLayout />);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  });

  it.each(["damage", "details", "step"])(
    "[regression] turns the swipe-to-close off mid-report (%s)",
    async (screen) => {
      mockSegments = ["felt-report", screen];
      await render(<FeltReportLayout />);
      expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
    },
  );

  it("allows it again on Thank you", async () => {
    mockSegments = ["felt-report", "done"];
    await render(<FeltReportLayout />);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  });

  it("leaves the web alone (no sheet there)", async () => {
    const original = Platform.OS;
    Platform.OS = "web";
    try {
      mockSegments = ["felt-report", "details"];
      await render(<FeltReportLayout />);
      expect(mockSetOptions).not.toHaveBeenCalled();
    } finally {
      Platform.OS = original;
    }
  });
});
