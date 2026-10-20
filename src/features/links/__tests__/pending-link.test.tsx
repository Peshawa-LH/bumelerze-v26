import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";

import {
  PENDING_LINK_MAX_AGE_MS,
  noteIncomingLink,
  useArrivedLinkStore,
  usePendingLink,
  usePendingLinkStore,
  webEntryPath,
  type PendingLinkOptions,
} from "../pending-link";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockPathname = "/onboarding";
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => mockPathname,
}));

const NOT_READY: PendingLinkOptions = { ready: false, onboardingCompleted: false };
const ONBOARDING: PendingLinkOptions = { ready: true, onboardingCompleted: false };
const DONE: PendingLinkOptions = { ready: true, onboardingCompleted: true };

function renderPendingLink(initialProps: PendingLinkOptions) {
  return renderHook((props: PendingLinkOptions) => usePendingLink(props), {
    initialProps,
  });
}

beforeEach(async () => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockPathname = "/onboarding";
  await AsyncStorage.clear();
  useArrivedLinkStore.setState({ arrived: null });
  usePendingLinkStore.setState({ pending: null, savedAt: null, hasHydrated: true });
});

describe("a link that opens the app before onboarding is done", () => {
  it("opens once onboarding completes, not before (the link was lost before)", async () => {
    // A fresh install opened from a shared link: Expo Router could only show
    // the onboarding, so the event screen never came.
    noteIncomingLink("/event/bml20170001");
    const { rerender } = await renderPendingLink(NOT_READY);
    expect(mockPush).not.toHaveBeenCalled();

    await rerender(ONBOARDING);
    expect(mockPush).not.toHaveBeenCalled();
    expect(usePendingLinkStore.getState().pending).toBe("/event/bml20170001");

    await rerender(DONE);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/event/bml20170001");
    expect(usePendingLinkStore.getState().pending).toBeNull();

    // Once only.
    await rerender(DONE);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("is kept on the device, so a restart during onboarding does not lose it", async () => {
    noteIncomingLink("/u/peshawa");
    const first = await renderPendingLink(ONBOARDING);
    await act(async () => {
      await Promise.resolve();
    });
    first.unmount();

    const saved = await AsyncStorage.getItem("bumelerze.pending-link");
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved ?? "{}").state).toEqual({
      pending: "/u/peshawa",
      savedAt: expect.any(Number),
    });

    // The app restarts (the reading-direction switch): memory is gone, the
    // device copy is read back. (Clearing the memory writes through to the
    // device copy, so it is put back as it was.)
    usePendingLinkStore.setState({ pending: null, savedAt: null, hasHydrated: false });
    await AsyncStorage.setItem("bumelerze.pending-link", saved ?? "");
    await act(async () => {
      await usePendingLinkStore.persist.rehydrate();
    });
    expect(usePendingLinkStore.getState().hasHydrated).toBe(true);

    await renderPendingLink(DONE);
    expect(mockPush).toHaveBeenCalledWith("/u/peshawa");
  });

  it("waits until the kept link has been read from the device", async () => {
    usePendingLinkStore.setState({
      pending: "/home/join?code=AB&key=xy",
      savedAt: Date.now(),
      hasHydrated: false,
    });
    await renderPendingLink(DONE);
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      usePendingLinkStore.setState({ hasHydrated: true });
    });
    expect(mockPush).toHaveBeenCalledWith("/home/join?code=AB&key=xy");
  });

  it("keeps the newest link when several arrive during onboarding", async () => {
    noteIncomingLink("/event/bml1");
    const { rerender } = await renderPendingLink(ONBOARDING);
    await act(async () => {
      noteIncomingLink("/event/bml2");
    });
    await rerender(DONE);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/event/bml2");
  });

  it("drops a kept link older than a day instead of opening it", async () => {
    usePendingLinkStore.setState({
      pending: "/event/bml1",
      savedAt: Date.now() - PENDING_LINK_MAX_AGE_MS - 1000,
    });
    await renderPendingLink(DONE);
    expect(mockPush).not.toHaveBeenCalled();
    expect(usePendingLinkStore.getState().pending).toBeNull();
  });

  it("leaves a screen outside the onboarding for the onboarding (the web's blank /e/<id>)", async () => {
    mockPathname = "/e/bml20170001";
    noteIncomingLink("/event/bml20170001");
    await renderPendingLink(ONBOARDING);
    expect(mockReplace).toHaveBeenCalledWith("/onboarding");
  });

  it("does not move a person who is already on an onboarding screen", async () => {
    mockPathname = "/onboarding/location";
    noteIncomingLink("/event/bml1");
    await renderPendingLink(ONBOARDING);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("a link that opens the app after onboarding", () => {
  it("is left to Expo Router, which already opened it, and never opened twice", async () => {
    mockPathname = "/event/bml1";
    noteIncomingLink("/event/bml1");
    await renderPendingLink(DONE);
    expect(useArrivedLinkStore.getState().arrived).toBeNull();
    expect(usePendingLinkStore.getState().pending).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("noteIncomingLink", () => {
  it("only notes the link in memory: nothing is written to the device yet", async () => {
    const before = await AsyncStorage.getItem("bumelerze.pending-link");
    noteIncomingLink("/event/bml1");
    expect(useArrivedLinkStore.getState().arrived).toBe("/event/bml1");
    expect(await AsyncStorage.getItem("bumelerze.pending-link")).toBe(before);
  });

  it.each(["/", "/?x=1", "/onboarding", "/onboarding/language"])(
    "does not keep %s",
    (path) => {
      noteIncomingLink(path);
      expect(useArrivedLinkStore.getState().arrived).toBeNull();
    },
  );
});

describe("webEntryPath", () => {
  it("is null in the iOS/Android app (the native link hook notes links there)", () => {
    expect(webEntryPath()).toBeNull();
  });
});
