import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import {
  FRESH_CHECK_EVERY_MS,
  TWO_STEP_CODE_PATH,
  __resetTwoStepGateForTests,
  useTwoStepGate,
} from "../use-two-step-gate";

/**
 * The start / foreground check: a device signed in to an account with
 * two-step sign-in on, but without a code in this session, is sent to
 * "Enter your code"; nobody else is ever interrupted.
 */

const mockPush = jest.fn();
let mockPathname = "/";
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
}));

const mockNeeded = jest.fn();
jest.mock("../two-step", () => ({
  twoStepCodeNeeded: (options: { fresh?: boolean }) => mockNeeded(options),
}));

let mockStatus = "account";
const mockEnsureSync = jest.fn();
jest.mock("../store", () => ({
  ensureAccountSync: () => mockEnsureSync(),
  useAccountStore: (select: (state: { status: string }) => unknown) =>
    select({ status: mockStatus }),
}));

let appStateListener: ((state: AppStateStatus) => void) | null = null;
const mockRemove = jest.fn();

const mounted: { unmount: () => unknown }[] = [];

async function mount(ready: boolean) {
  const hook = await renderHook(() => useTwoStepGate(ready));
  mounted.push(hook);
  return hook;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function comeBack() {
  await act(async () => {
    appStateListener?.("active");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useTwoStepGate", () => {
  let now = 1_000_000;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetTwoStepGateForTests();
    mockPathname = "/";
    mockStatus = "account";
    mockNeeded.mockResolvedValue(false);
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    appStateListener = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      appStateListener = listener as (state: AppStateStatus) => void;
      return { remove: mockRemove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(async () => {
    await act(async () => {
      for (const hook of mounted.splice(0)) {
        await hook.unmount();
      }
    });
    jest.restoreAllMocks();
  });

  it("at start, asks the server once and opens 'Enter your code' when the code is still to come", async () => {
    mockNeeded.mockResolvedValue(true);
    await mount(true);
    await settle();
    expect(mockNeeded).toHaveBeenCalledWith({ fresh: true });
    expect(mockPush).toHaveBeenCalledWith(TWO_STEP_CODE_PATH);
    expect(TWO_STEP_CODE_PATH).toBe("/account/two-step-code");
  });

  it("does nothing when the account has no code to give", async () => {
    await mount(true);
    await settle();
    expect(mockNeeded).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("never checks for a guest, or before the app is ready", async () => {
    mockStatus = "anonymous";
    await mount(true);
    await settle();
    mockStatus = "account";
    await mount(false);
    await settle();
    expect(mockNeeded).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it.each([
    "/account/sign-in",
    "/account/password",
    "/account/two-step",
    "/account/two-step-code",
  ])("never interrupts %s (it handles the code itself)", async (path) => {
    mockPathname = path;
    mockNeeded.mockResolvedValue(true);
    await mount(true);
    await settle();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("checks again on return to the app: the stored session within 10 minutes, the server after", async () => {
    await mount(true);
    await settle();
    expect(mockNeeded).toHaveBeenLastCalledWith({ fresh: true });

    now += 60_000;
    await comeBack();
    expect(mockNeeded).toHaveBeenLastCalledWith({ fresh: false });

    now += FRESH_CHECK_EVERY_MS;
    mockNeeded.mockResolvedValue(true);
    await comeBack();
    expect(mockNeeded).toHaveBeenLastCalledWith({ fresh: true });
    expect(mockPush).toHaveBeenCalledWith(TWO_STEP_CODE_PATH);
  });

  it("ignores going to the background", async () => {
    await mount(true);
    await settle();
    await act(async () => {
      appStateListener?.("background");
    });
    expect(mockNeeded).toHaveBeenCalledTimes(1);
  });

  it("stops listening when the account signs out", async () => {
    const { rerender } = await mount(true);
    await settle();
    mockStatus = "anonymous";
    await act(async () => {
      await rerender({});
    });
    expect(mockRemove).toHaveBeenCalled();
  });
});
