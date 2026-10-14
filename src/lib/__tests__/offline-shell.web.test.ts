import {
  createUpdateOnResume,
  isTabRootPath,
  liveBuildId,
  startUpdateOnResume,
  UPDATE_CHECK_MIN_INTERVAL_MS,
  type UpdateEnvironment,
} from "../offline-shell.web";

/**
 * Update on resume (incident 2026-10-14): a tab left open for days must pick
 * up a newer deploy when it comes back into view — but never mid-form, and
 * without asking the server more than once every five minutes.
 */
const PAGE = (build: string) =>
  `<!DOCTYPE html><html><head><meta name="bumelerze-build" content="${build}"><title>Bumelerze</title></head><body></body></html>`;

function fakeEnv(overrides: Partial<UpdateEnvironment> = {}) {
  let now = 1_000_000;
  const listeners = new Map<string, Set<() => void>>();
  const env: UpdateEnvironment = {
    build: "old",
    isDevelopment: false,
    fetchLivePage: jest.fn(async () => PAGE("old")),
    updateServiceWorker: jest.fn(async () => undefined),
    isOnline: () => true,
    reload: jest.fn(),
    now: () => now,
    addListener: jest.fn((type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
      return () => set.delete(listener);
    }),
    isVisible: () => true,
    ...overrides,
  };
  return {
    env,
    advance: (ms: number) => {
      now += ms;
    },
    fire: (type: string) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

const safe = { isSafeToReload: () => true };

describe("liveBuildId", () => {
  it("reads the build stamp the build script puts in the page", () => {
    expect(liveBuildId(PAGE("abc123"))).toBe("abc123");
  });
  it("is null for a page without the stamp (a development server, another site)", () => {
    expect(liveBuildId("<html><head></head></html>")).toBeNull();
  });
});

describe("isTabRootPath", () => {
  it.each(["/", "/map", "/sensor", "/profile", "/settings", "/settings/"])(
    "%s is a tab root",
    (path) => {
      expect(isTabRootPath(path)).toBe(true);
    },
  );
  it.each(["/world", "/event/bml20170001", "/felt-report", "/im-safe", "/settings/x"])(
    "%s is not",
    (path) => {
      expect(isTabRootPath(path)).toBe(false);
    },
  );
});

describe("createUpdateOnResume", () => {
  it("does not look at the server within five minutes of the page load", async () => {
    const { env } = fakeEnv();
    const checker = createUpdateOnResume(safe, env);
    expect(await checker.check()).toBe("skipped");
    expect(env.fetchLivePage).not.toHaveBeenCalled();
  });

  it("after the interval: same build, nothing happens", async () => {
    const { env, advance } = fakeEnv();
    const checker = createUpdateOnResume(safe, env);
    advance(UPDATE_CHECK_MIN_INTERVAL_MS);
    expect(await checker.check()).toBe("current");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("a newer deploy: the worker is asked to update, then the page reloads", async () => {
    const { env, advance } = fakeEnv({ fetchLivePage: jest.fn(async () => PAGE("new")) });
    const checker = createUpdateOnResume(safe, env);
    advance(UPDATE_CHECK_MIN_INTERVAL_MS);
    expect(await checker.check()).toBe("reloaded");
    expect(env.updateServiceWorker).toHaveBeenCalledTimes(1);
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads mid-form: the update waits for the next resume that is safe, with no second fetch", async () => {
    const { env, advance } = fakeEnv({ fetchLivePage: jest.fn(async () => PAGE("new")) });
    let safeNow = false;
    const checker = createUpdateOnResume({ isSafeToReload: () => safeNow }, env);
    advance(UPDATE_CHECK_MIN_INTERVAL_MS);
    expect(await checker.check()).toBe("deferred");
    expect(env.reload).not.toHaveBeenCalled();
    expect(checker.pendingBuild()).toBe("new");

    // Still in the form a moment later.
    advance(1000);
    expect(await checker.check()).toBe("deferred");

    safeNow = true;
    expect(await checker.check()).toBe("reloaded");
    expect(env.fetchLivePage).toHaveBeenCalledTimes(1);
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it("asks the server at most once per five minutes", async () => {
    const { env, advance } = fakeEnv();
    const checker = createUpdateOnResume(safe, env);
    advance(UPDATE_CHECK_MIN_INTERVAL_MS);
    await checker.check();
    advance(UPDATE_CHECK_MIN_INTERVAL_MS - 1000);
    await checker.check();
    expect(env.fetchLivePage).toHaveBeenCalledTimes(1);
    advance(1000);
    await checker.check();
    expect(env.fetchLivePage).toHaveBeenCalledTimes(2);
  });

  it("skips while offline, and when the page cannot be fetched or carries no stamp", async () => {
    const offline = fakeEnv({ isOnline: () => false });
    const checker = createUpdateOnResume(safe, offline.env);
    offline.advance(UPDATE_CHECK_MIN_INTERVAL_MS);
    expect(await checker.check()).toBe("skipped");
    expect(offline.env.fetchLivePage).not.toHaveBeenCalled();

    const failing = fakeEnv({ fetchLivePage: jest.fn(async () => null) });
    const checker2 = createUpdateOnResume(safe, failing.env);
    failing.advance(UPDATE_CHECK_MIN_INTERVAL_MS);
    expect(await checker2.check()).toBe("skipped");

    const unstamped = fakeEnv({ fetchLivePage: jest.fn(async () => "<html></html>") });
    const checker3 = createUpdateOnResume(safe, unstamped.env);
    unstamped.advance(UPDATE_CHECK_MIN_INTERVAL_MS);
    expect(await checker3.check()).toBe("current");
    expect(unstamped.env.reload).not.toHaveBeenCalled();
  });

  it("a worker that never answers does not hold the reload back", async () => {
    jest.useFakeTimers();
    try {
      const { env, advance } = fakeEnv({
        fetchLivePage: jest.fn(async () => PAGE("new")),
        updateServiceWorker: () => new Promise<void>(() => undefined),
      });
      const checker = createUpdateOnResume(safe, env);
      advance(UPDATE_CHECK_MIN_INTERVAL_MS);
      const outcome = checker.check();
      await jest.advanceTimersByTimeAsync(3100);
      expect(await outcome).toBe("reloaded");
    } finally {
      jest.useRealTimers();
    }
  });

  it("does nothing in development or without a build id", async () => {
    const dev = fakeEnv({ isDevelopment: true });
    const checker = createUpdateOnResume(safe, dev.env);
    dev.advance(UPDATE_CHECK_MIN_INTERVAL_MS);
    expect(await checker.check()).toBe("skipped");
    const noBuild = fakeEnv({ build: undefined });
    const checker2 = createUpdateOnResume(safe, noBuild.env);
    noBuild.advance(UPDATE_CHECK_MIN_INTERVAL_MS);
    expect(await checker2.check()).toBe("skipped");
  });
});

describe("startUpdateOnResume", () => {
  it("checks when the page becomes visible or focused, and stops when told", async () => {
    const { env, advance, fire, listenerCount } = fakeEnv({
      fetchLivePage: jest.fn(async () => PAGE("new")),
    });
    const stop = startUpdateOnResume(safe, env);
    expect(listenerCount("visibilitychange")).toBe(1);
    expect(listenerCount("focus")).toBe(1);

    advance(UPDATE_CHECK_MIN_INTERVAL_MS);
    fire("visibilitychange");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(env.fetchLivePage).toHaveBeenCalledTimes(1);

    stop();
    expect(listenerCount("visibilitychange")).toBe(0);
    expect(listenerCount("focus")).toBe(0);
  });

  it("a hidden page (the event fired on the way out) is not checked", async () => {
    const { env, advance, fire } = fakeEnv({ isVisible: () => false });
    startUpdateOnResume(safe, env);
    advance(UPDATE_CHECK_MIN_INTERVAL_MS);
    fire("visibilitychange");
    await Promise.resolve();
    expect(env.fetchLivePage).not.toHaveBeenCalled();
  });

  it("registers nothing without a browser or build", () => {
    const stop = startUpdateOnResume(safe, null);
    expect(typeof stop).toBe("function");
    const { env } = fakeEnv({ build: undefined });
    startUpdateOnResume(safe, env);
    expect(env.addListener).not.toHaveBeenCalled();
  });
});
