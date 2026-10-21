import {
  defaultShouldDehydrateQuery,
  type Query,
  type QueryState,
} from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

/**
 * Which queries the on-device React Query cache may write to storage: every
 * query that holds data, except queries marked `meta: { persist: false }`
 * (private data such as home tags with exact locations and join keys stays
 * in memory only).
 *
 * "Holds data" includes a query whose latest refresh FAILED: React Query
 * then marks it as an error but keeps the data of its last success. React
 * Query's default rule saves successful queries only, so one failed refresh
 * (a network that is connected but reaches nothing) left the feed and the
 * maps out of the next save; reopened offline, Home said "Couldn't load the
 * latest events" instead of showing the saved list (2026-10-21).
 * `keepLastGoodData` saves such a query as its last success.
 */
export function shouldPersistQuery(query: Query): boolean {
  if (query.meta?.persist === false) {
    return false;
  }
  return defaultShouldDehydrateQuery(query) || failedWithData(query.state);
}

function failedWithData(state: QueryState): boolean {
  return state.status === "error" && state.data !== undefined;
}

/**
 * The cache as it goes to the device, with every query whose latest refresh
 * failed written as its last good result: a success, with the time of that
 * success (the offline note's "Events from …"), no error. Read back on the
 * next start it is saved data due for a refresh, as before the failure; an
 * error state read back would show the offline note even on a working
 * connection, until the first refresh came back.
 */
export function keepLastGoodData(client: PersistedClient): PersistedClient {
  const queries = client.clientState.queries;
  if (!queries.some((query) => failedWithData(query.state))) {
    return client;
  }
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: queries.map((query) =>
        failedWithData(query.state)
          ? {
              ...query,
              state: {
                ...query.state,
                status: "success",
                error: null,
                fetchFailureCount: 0,
                fetchFailureReason: null,
              },
            }
          : query,
      ),
    },
  };
}

/** `persister`, writing the cache through `keepLastGoodData`. */
export function persistLastGoodData(persister: Persister): Persister {
  return {
    persistClient: (client) => persister.persistClient(keepLastGoodData(client)),
    restoreClient: () => persister.restoreClient(),
    removeClient: () => persister.removeClient(),
  };
}
