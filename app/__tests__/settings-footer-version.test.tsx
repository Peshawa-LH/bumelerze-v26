import { cleanup, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";

/**
 * The Settings footer version line (D90): "Version 26.3.0" on development and
 * native builds, "Version 26.3.0 (abc1234)" on a hosted web build. The build
 * hash is a code: it keeps Latin digits in Sorani and Arabic and sits inside
 * isolates (LRI U+2066 ... PDI U+2069) so it reads left to right in RTL text.
 * Same mocks as `settings-permissions.test.tsx`.
 */

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    useRouter: () => ({ push: jest.fn() }),
  };
});

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "26.3.0" } },
}));

jest.mock("expo-linking", () => ({
  openSettings: jest.fn(),
  openURL: jest.fn(),
}));

jest.mock("expo-location", () => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  getForegroundPermissionsAsync: () => Promise.resolve({ status: "undetermined" }),
  requestForegroundPermissionsAsync: () => Promise.resolve({ status: "undetermined" }),
}));

jest.mock("expo-sensors", () => ({
  Accelerometer: {
    getPermissionsAsync: () => Promise.resolve({ status: "undetermined" }),
    requestPermissionsAsync: () => Promise.resolve({ status: "undetermined" }),
  },
}));

// Imported after the mocks above so the mocked module graph is in place.
// eslint-disable-next-line import/first -- see comment above
import SettingsScreen from "../(tabs)/(settings)/settings";

const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderWithProviders(ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function versionLine(): Promise<string> {
  await renderWithProviders(<SettingsScreen />);
  await flush();
  const node = screen.getByTestId("settings-footer-version");
  const children = node.props.children as unknown;
  return Array.isArray(children) ? children.join("") : String(children);
}

const SHA = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const LRI = "⁦";
const PDI = "⁩";

describe("Settings footer version line", () => {
  const originalBuildId = process.env.EXPO_PUBLIC_BUILD_ID;

  afterEach(async () => {
    await cleanup();
    if (originalBuildId === undefined) {
      delete process.env.EXPO_PUBLIC_BUILD_ID;
    } else {
      process.env.EXPO_PUBLIC_BUILD_ID = originalBuildId;
    }
    await i18n.changeLanguage("en");
  });

  it("en, no build id: the plain version", async () => {
    delete process.env.EXPO_PUBLIC_BUILD_ID;
    await i18n.changeLanguage("en");
    expect(await versionLine()).toBe("Version 26.3.0");
  });

  it("en, hosted web build: the version and the isolated short hash", async () => {
    process.env.EXPO_PUBLIC_BUILD_ID = SHA;
    await i18n.changeLanguage("en");
    expect(await versionLine()).toBe(`Version 26.3.0 (${LRI}1a2b3c4${PDI})`);
  });

  it("ckb, no build id: the version in Sorani digits", async () => {
    delete process.env.EXPO_PUBLIC_BUILD_ID;
    await i18n.changeLanguage("ckb");
    expect(await versionLine()).toBe("وەشانی ٢٦.٣.٠");
  });

  it("ckb, hosted web build: Sorani digits for the version, Latin for the isolated hash", async () => {
    process.env.EXPO_PUBLIC_BUILD_ID = SHA;
    await i18n.changeLanguage("ckb");
    expect(await versionLine()).toBe(`وەشانی ٢٦.٣.٠ (${LRI}1a2b3c4${PDI})`);
  });

  it("a 'local' build id is not shown", async () => {
    process.env.EXPO_PUBLIC_BUILD_ID = "local";
    await i18n.changeLanguage("en");
    expect(await versionLine()).toBe("Version 26.3.0");
  });
});
