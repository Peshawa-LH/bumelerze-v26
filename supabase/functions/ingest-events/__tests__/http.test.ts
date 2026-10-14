import { fetchJsonWithRetry, fetchTextWithRetry, isEmptyFeedBody } from "../http";

describe("fetchTextWithRetry", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns the body text on a successful first attempt, no retry", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => "hello" });
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
      fetchTextWithRetry("https://example.test", {
        timeoutMs: 1000,
        retryDelayMs: 1,
        retries: 0,
      }),
    ).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats 204 No Content (the FDSN 'no matching events' answer) as an empty body, not a failure, and does not retry it", async () => {
    // A real 204 has no body; `text()` would resolve "" anyway, but the
    // helper must not even depend on that.
    const text = jest.fn();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204, text });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchTextWithRetry("https://example.test", { timeoutMs: 1000 });

    expect(result).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
  });
});

describe("isEmptyFeedBody", () => {
  it("is true for nothing at all and for whitespace only", () => {
    expect(isEmptyFeedBody("")).toBe(true);
    expect(isEmptyFeedBody(" \n\t\r\n")).toBe(true);
  });

  it("is false as soon as there is any content, even an empty JSON list", () => {
    expect(isEmptyFeedBody("[]")).toBe(false);
    expect(isEmptyFeedBody('{"type":"FeatureCollection","features":[]}')).toBe(false);
    expect(isEmptyFeedBody("#EventID|Time\n")).toBe(false);
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
      status: 200,
      text: async () => JSON.stringify({ hello: "world" }),
    }) as unknown as typeof fetch;

    const result = await fetchJsonWithRetry("https://example.test", { timeoutMs: 1000 });
    expect(result).toEqual({ hello: "world" });
  });

  it("resolves null (zero events) for a 204 No Content instead of failing on JSON.parse('') (D-9)", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchJsonWithRetry("https://example.test", { timeoutMs: 1000 });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves null for a 200 whose body is blank or whitespace (seen from EMSC)", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => " \n",
      }) as unknown as typeof fetch;

    const result = await fetchJsonWithRetry("https://example.test", { timeoutMs: 1000 });
    expect(result).toBeNull();
  });

  it("still throws when a body is present but is not JSON (a genuine feed problem)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html>Service Unavailable</html>",
    }) as unknown as typeof fetch;

    await expect(
      fetchJsonWithRetry("https://example.test", { timeoutMs: 1000, retries: 0 }),
    ).rejects.toThrow(SyntaxError);
  });
});
