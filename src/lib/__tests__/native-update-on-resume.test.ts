/**
 * iOS/Android update on resume through EAS Update
 * (`src/lib/native-update-on-resume.ts`), driven by a fake environment.
 */
import {
  createNativeUpdateOnResume,
  NATIVE_UPDATE_CHECK_MIN_INTERVAL_MS,
  startNativeUpdateOnResume,
  type NativeUpdateEnvironment,
} from "../native-update-on-resume";

function fakeEnv(overrides: Partial<NativeUpdateEnvironment> = {}) {
  let now = 1_000_000;
  const foregroundListeners: (() => void)[] = [];
  const env: NativeUpdateEnvironment = {
    isEnabled: true,
    checkForUpdate: jest.fn(async () => true),
    fetchUpdate: jest.fn(async () => true),
    reload: jest.fn(async () => undefined),
    isOnline: () => true,
    now: () => now,
    onForeground: jest.fn((listener: () => void) => {
      foregroundListeners.push(listener);
      return () => {
        foregroundListeners.splice(foregroundListeners.indexOf(listener), 1);
      };
    }),
    ...overrides,
  };
  return {
    env,
    advance(ms: number) {
      now += ms;
    },
    comeBack() {
      for (const listener of [...foregroundListeners]) listener();
    },
    listenerCount: () => foregroundListeners.length,
  };
}

const AFTER_INTERVAL = NATIVE_UPDATE_CHECK_MIN_INTERVAL_MS + 1;

describe("native update on resume", () => {
  it("does nothing while expo-updates is off (no Expo project yet, development builds)", async () => {
    const fake = fakeEnv({ isEnabled: false });
    const stop = startNativeUpdateOnResume({ isSafeToReload: () => true }, fake.env);
    expect(fake.env.onForeground).not.toHaveBeenCalled();
    stop();

    const checker = createNativeUpdateOnResume({ isSafeToReload: () => true }, fake.env);
    fake.advance(AFTER_INTERVAL);
    await expect(checker.check()).resolves.toBe("skipped");
    expect(fake.env.checkForUpdate).not.toHaveBeenCalled();
  });

  it("waits a full interval after launch, then asks again at most every five minutes", async () => {
    const fake = fakeEnv({ checkForUpdate: jest.fn(async () => false) });
    const checker = createNativeUpdateOnResume({ isSafeToReload: () => true }, fake.env);

    await expect(checker.check()).resolves.toBe("skipped");
    fake.advance(AFTER_INTERVAL);
    await expect(checker.check()).resolves.toBe("current");
    fake.advance(60_000);
    await expect(checker.check()).resolves.toBe("skipped");
    expect(fake.env.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not ask the server while offline", async () => {
    const fake = fakeEnv({ isOnline: () => false });
    const checker = createNativeUpdateOnResume({ isSafeToReload: () => true }, fake.env);
    fake.advance(AFTER_INTERVAL);
    await expect(checker.check()).resolves.toBe("skipped");
    expect(fake.env.checkForUpdate).not.toHaveBeenCalled();
  });

  it("downloads a newer update and restarts into it at a safe moment", async () => {
    const fake = fakeEnv();
    const checker = createNativeUpdateOnResume({ isSafeToReload: () => true }, fake.env);
    fake.advance(AFTER_INTERVAL);
    await expect(checker.check()).resolves.toBe("reloaded");
    expect(fake.env.fetchUpdate).toHaveBeenCalledTimes(1);
    expect(fake.env.reload).toHaveBeenCalledTimes(1);
  });

  it("never restarts mid-form: the update waits for the next safe resume without asking again", async () => {
    let safe = false;
    const fake = fakeEnv();
    const checker = createNativeUpdateOnResume({ isSafeToReload: () => safe }, fake.env);
    fake.advance(AFTER_INTERVAL);
    await expect(checker.check()).resolves.toBe("deferred");
    expect(checker.hasPendingUpdate()).toBe(true);
    expect(fake.env.reload).not.toHaveBeenCalled();

    // Back from the felt report, a few seconds later: no new server request.
    safe = true;
    fake.advance(5_000);
    await expect(checker.check()).resolves.toBe("reloaded");
    expect(fake.env.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(fake.env.reload).toHaveBeenCalledTimes(1);
  });

  it("keeps running the current version when the check or the download fails", async () => {
    const fake = fakeEnv({
      fetchUpdate: jest.fn(async () => {
        throw new Error("network");
      }),
    });
    const checker = createNativeUpdateOnResume({ isSafeToReload: () => true }, fake.env);
    fake.advance(AFTER_INTERVAL);
    await expect(checker.check()).resolves.toBe("failed");
    expect(checker.hasPendingUpdate()).toBe(false);
    expect(fake.env.reload).not.toHaveBeenCalled();
  });

  it("restarts nothing when the server has nothing newer to download", async () => {
    const fake = fakeEnv({ fetchUpdate: jest.fn(async () => false) });
    const checker = createNativeUpdateOnResume({ isSafeToReload: () => true }, fake.env);
    fake.advance(AFTER_INTERVAL);
    await expect(checker.check()).resolves.toBe("current");
    expect(fake.env.reload).not.toHaveBeenCalled();
  });

  it("runs on each return to the foreground and stops listening when asked", async () => {
    const fake = fakeEnv();
    const stop = startNativeUpdateOnResume({ isSafeToReload: () => true }, fake.env);
    expect(fake.listenerCount()).toBe(1);
    fake.advance(AFTER_INTERVAL);
    fake.comeBack();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.env.checkForUpdate).toHaveBeenCalledTimes(1);
    stop();
    expect(fake.listenerCount()).toBe(0);
  });
});
