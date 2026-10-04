import { defaultShouldDehydrateQuery, type Query } from "@tanstack/react-query";

/**
 * Which queries the on-device React Query cache may write to storage.
 * Everything the default rule allows, except queries marked
 * `meta: { persist: false }`: private data (home tags with exact locations,
 * join keys) stays in memory only.
 */
export function shouldPersistQuery(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && query.meta?.persist !== false;
}
