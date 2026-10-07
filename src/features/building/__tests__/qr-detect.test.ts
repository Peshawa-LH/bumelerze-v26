import { SCAN_INTERVAL_MS, watchForQr } from "../qr-detect";

describe("watchForQr", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup(results: ({ rawValue: string }[] | Error)[]) {
    const detect = jest.fn(async () => {
      const next = results.shift() ?? [];
      if (next instanceof Error) throw next;
      return next;
    });
    const onCode = jest.fn();
    const stop = watchForQr({}, { detect }, onCode);
    return { detect, onCode, stop };
  }

  async function advance(ms: number) {
    await jest.advanceTimersByTimeAsync(ms);
  }

  it("reports the first QR text it sees, once, then stops looking", async () => {
    const { detect, onCode } = setup([
      [],
      [],
      [{ rawValue: "the-code" }, { rawValue: "other" }],
    ]);
    await advance(SCAN_INTERVAL_MS * 6);
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith("the-code");
    expect(detect).toHaveBeenCalledTimes(3);
  });

  it("looks a few times a second, not on every frame", async () => {
    const { detect } = setup([]);
    await advance(1000);
    expect(detect.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(detect.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("skips a frame that cannot be read and keeps going", async () => {
    const { onCode } = setup([new Error("not ready"), [{ rawValue: "ok" }]]);
    await advance(SCAN_INTERVAL_MS * 3);
    expect(onCode).toHaveBeenCalledWith("ok");
  });

  it("stop() ends the watching at once", async () => {
    const { detect, onCode, stop } = setup([]);
    await advance(SCAN_INTERVAL_MS * 2);
    stop();
    detect.mockClear();
    await advance(SCAN_INTERVAL_MS * 10);
    expect(detect).not.toHaveBeenCalled();
    expect(onCode).not.toHaveBeenCalled();
  });
});
