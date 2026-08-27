import { fetchJsonWithRetry, fetchTextWithRetry } from "../http";

describe("fetchTextWithRetry", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns the body text on a successful first attempt, no retry", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => "hello" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchTextWithRetry("https://example.test", { timeoutMs: 1000 });

    expect(result).toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once (the documented bounded-retry policy) after a failure, then succeeds", async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce({ ok: true, text: async () => "recovered" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchTextWithRetry("https://example.test", {
      timeoutMs: 1000,
      retryDelayMs: 1, // keep the test fast
    });

    expect(result).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting the bounded retry count, throwing the last error", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error("still down"));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      fetchTextWithRetry("https://example.test", { timeoutMs: 1000, retryDelayMs: 1 }),
    ).rejects.toThrow("still down");
    // 1 initial attempt + 1 default retry = 2 total, never more.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-OK HTTP status without retrying past the bound", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      fetchTextWithRetry("https://example.test", { timeoutMs: 1000, retryDelayMs: 1, retries: 0 }),
    ).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchJsonWithRetry", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("parses the response body as JSON", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ hello: "world" }),
    }) as unknown as typeof fetch;

    const result = await fetchJsonWithRetry("https://example.test", { timeoutMs: 1000 });
    expect(result).toEqual({ hello: "world" });
  });
});
