import { installChunkReloadGuard } from "../web-chunk-reload";

type Listener = (event: unknown) => void;

function makeGuardWindow() {
  const listeners = new Map<string, Listener[]>();
  const storage = new Map<string, string>();
  const reload = jest.fn();
  const win = {
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    sessionStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
    location: { reload },
  };
  const fire = (type: string, event: unknown) => {
    for (const l of listeners.get(type) ?? []) l(event);
  };
  return { win, fire, reload, storage };
}

describe("web chunk-reload guard (stale-deploy self-heal)", () => {
  it("reloads once on a module-script MIME failure, and only once per session", () => {
    const { win, fire, reload } = makeGuardWindow();
    installChunkReloadGuard(win as never);

    fire("error", {
      message:
        'Failed to load module script: The server responded with a non-JavaScript MIME type of "text/html".',
    });
    expect(reload).toHaveBeenCalledTimes(1);

    fire("error", { message: "Failed to load module script: ..." });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on a rejected dynamic import (unhandledrejection path)", () => {
    const { win, fire, reload } = makeGuardWindow();
    installChunkReloadGuard(win as never);

    fire("unhandledrejection", {
      reason: { message: "Failed to fetch dynamically imported module: x.js" },
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated errors entirely", () => {
    const { win, fire, reload } = makeGuardWindow();
    installChunkReloadGuard(win as never);

    fire("error", { message: "ReferenceError: foo is not defined" });
    fire("unhandledrejection", { reason: { message: "network timeout" } });
    expect(reload).not.toHaveBeenCalled();
  });

  it("clears the once-per-session guard on a successful load so a future deploy can self-heal again", () => {
    const { win, fire, reload } = makeGuardWindow();
    installChunkReloadGuard(win as never);

    fire("error", { message: "Failed to load module script: stale chunk" });
    expect(reload).toHaveBeenCalledTimes(1);

    fire("load", {});
    fire("error", { message: "Failed to load module script: stale chunk" });
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
