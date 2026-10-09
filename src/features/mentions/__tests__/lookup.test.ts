import { MentionLookupBatcher } from "../lookup";
import { parseSuggestions, type MentionsTransport } from "../transport";

function fakeTransport(existing: string[]) {
  return {
    lookup: jest.fn(async (names: readonly string[]) =>
      names.filter((name) => existing.includes(name)),
    ),
    suggest: jest.fn(async () => []),
  } satisfies MentionsTransport;
}

describe("MentionLookupBatcher", () => {
  it("answers many comments with one call, then from memory", async () => {
    const transport = fakeTransport(["shirin", "aso"]);
    const batcher = new MentionLookupBatcher(transport);
    const [a, b, c] = await Promise.all([
      batcher.resolve(["shirin", "nobody"]),
      batcher.resolve(["aso"]),
      batcher.resolve(["shirin"]),
    ]);
    expect(transport.lookup).toHaveBeenCalledTimes(1);
    expect(transport.lookup.mock.calls[0]?.[0]).toEqual(["shirin", "nobody", "aso"]);
    expect([...a]).toEqual(["shirin"]);
    expect([...b]).toEqual(["aso"]);
    expect([...c]).toEqual(["shirin"]);
    const again = await batcher.resolve(["nobody", "aso"]);
    expect([...again]).toEqual(["aso"]);
    expect(transport.lookup).toHaveBeenCalledTimes(1);
  });

  it("asks again after ten minutes", async () => {
    let now = 0;
    const transport = fakeTransport(["shirin"]);
    const batcher = new MentionLookupBatcher(transport, () => now);
    await batcher.resolve(["shirin"]);
    now = 11 * 60_000;
    await batcher.resolve(["shirin"]);
    expect(transport.lookup).toHaveBeenCalledTimes(2);
  });

  it("sends at most 50 names a call", async () => {
    const names = Array.from({ length: 120 }, (_, i) => `user${i}`);
    const transport = fakeTransport([]);
    await new MentionLookupBatcher(transport).resolve(names);
    expect(transport.lookup.mock.calls.map((call) => call[0].length)).toEqual([
      50, 50, 20,
    ]);
  });

  it("passes a failure to every caller", async () => {
    const transport = fakeTransport([]);
    transport.lookup.mockRejectedValueOnce(new Error("offline"));
    await expect(new MentionLookupBatcher(transport).resolve(["x_y"])).rejects.toThrow(
      "offline",
    );
  });
});

describe("parseSuggestions", () => {
  it("keeps public fields only and drops bad rows", () => {
    const rows = parseSuggestions([
      {
        user_id: "u1",
        username: "shirin",
        display_name: "Shirin",
        avatar_path: null,
        relation: "following",
        email: "x@y",
      },
      { user_id: "u2", username: "aso", relation: "strange" },
      { username: "missing-id" },
    ]);
    expect(rows).toEqual([
      {
        userId: "u1",
        username: "shirin",
        displayName: "Shirin",
        avatarPath: null,
        relation: "following",
      },
      {
        userId: "u2",
        username: "aso",
        displayName: null,
        avatarPath: null,
        relation: "other",
      },
    ]);
  });
});
