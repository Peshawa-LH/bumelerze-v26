import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabasePeopleTransport, type PeopleTransport } from "./transport";
import type { PeopleCursor, PeopleQuery, ResettableField } from "./types";

/** Personal data: never written to the on-device cache. */
const NOT_PERSISTED = { persist: false } as const;

/** All under "admin", so every admin action that refreshes the admin lists
 * refreshes these too. */
export const peopleKeys = {
  all: ["admin", "people"] as const,
  search: (query: PeopleQuery) => ["admin", "people", "search", query] as const,
  stats: ["admin", "people", "stats"] as const,
  person: (userId: string) => ["admin", "people", "person", userId] as const,
  notes: (userId: string) => ["admin", "people", "notes", userId] as const,
};

/** The value, but only after it has stopped changing for `delayMs`. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** The directory, 50 rows a page; `fetchNextPage` loads the next 50 (keyset). */
export function usePeopleSearch(
  query: PeopleQuery,
  enabled: boolean,
  transport: PeopleTransport = SupabasePeopleTransport,
) {
  return useInfiniteQuery({
    queryKey: peopleKeys.search(query),
    queryFn: ({ pageParam }) => transport.search(query, pageParam),
    initialPageParam: null as PeopleCursor | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export function usePeopleStats(
  enabled: boolean,
  transport: PeopleTransport = SupabasePeopleTransport,
) {
  return useQuery({
    queryKey: peopleKeys.stats,
    queryFn: () => transport.stats(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 60_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

/** One person. Opening it writes an audit row on the server, so it is not
 * refetched on focus or reconnect. */
export function usePerson(
  userId: string,
  enabled: boolean,
  transport: PeopleTransport = SupabasePeopleTransport,
) {
  return useQuery({
    queryKey: peopleKeys.person(userId),
    queryFn: () => transport.person(userId),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export function usePersonNotes(
  userId: string,
  enabled: boolean,
  transport: PeopleTransport = SupabasePeopleTransport,
) {
  return useQuery({
    queryKey: peopleKeys.notes(userId),
    queryFn: () => transport.notes(userId),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export interface PeopleActions {
  revealEmail: (userId: string) => Promise<string | null>;
  /** Resolves with the audit row id for Undo, or null when nothing changed. */
  resetProfile: (userId: string, fields: ResettableField[]) => Promise<string | null>;
  addNote: (userId: string, body: string) => Promise<void>;
}

export function usePeopleActions(
  transport: PeopleTransport = SupabasePeopleTransport,
): PeopleActions {
  const queryClient = useQueryClient();
  const refreshPerson = (userId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: peopleKeys.person(userId) }),
      queryClient.invalidateQueries({ queryKey: ["admin", "activity"] }),
      queryClient.invalidateQueries({ queryKey: [...peopleKeys.all, "search"] }),
    ]);
  const reveal = useMutation({
    mutationFn: (userId: string) => transport.revealEmail(userId),
    // the reveal is an audit row: show it in the person's history
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "activity"] }),
  });
  const reset = useMutation({
    mutationFn: (input: { userId: string; fields: ResettableField[] }) =>
      transport.resetProfile(input.userId, input.fields),
    onSuccess: (_logId, input) => refreshPerson(input.userId),
  });
  const note = useMutation({
    mutationFn: (input: { userId: string; body: string }) =>
      transport.addNote(input.userId, input.body),
    onSuccess: (_void, input) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: peopleKeys.notes(input.userId) }),
        queryClient.invalidateQueries({ queryKey: peopleKeys.person(input.userId) }),
      ]),
  });
  return {
    revealEmail: (userId) => reveal.mutateAsync(userId),
    resetProfile: (userId, fields) => reset.mutateAsync({ userId, fields }),
    addNote: (userId, body) => note.mutateAsync({ userId, body }),
  };
}
