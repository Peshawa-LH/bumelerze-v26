import { QueryClient, dehydrate } from "@tanstack/react-query";

import { shouldPersistQuery } from "../persist-filter";

describe("shouldPersistQuery", () => {
  it("persists ordinary successful queries but never ones marked persist:false", async () => {
    const client = new QueryClient();
    await client.prefetchQuery({
      queryKey: ["events", "region"],
      queryFn: async () => [1],
    });
    await client.prefetchQuery({
      queryKey: ["home", "mine", "u1"],
      queryFn: async () => ({ lat: 36.19, lon: 44.01, joinKey: "ABCD2345" }),
      meta: { persist: false },
    });
    const state = dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery });
    const keys = state.queries.map((query) => query.queryKey[0]);
    expect(keys).toEqual(["events"]);
    expect(JSON.stringify(state)).not.toContain("ABCD2345");
    client.clear();
  });
});
