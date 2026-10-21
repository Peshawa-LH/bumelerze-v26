import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useAccount } from "@/features/account/use-account";
import type { MentionSuggestion } from "@/features/mentions/transport";
import { isSupabaseConfigured } from "@/lib/supabase";
import { searchPrefix } from "./query";
import { SupabasePeopleSearchTransport, type PeopleSearchTransport } from "./transport";

/** Who is found depends on the viewer (follows, blocks), and a search is not
 * worth keeping: nothing is written to the on-device cache. */
const NOT_PERSISTED = { persist: false } as const;
/** Wait this long after the last key before asking the server. */
const SETTLE_MS = 250;
const NONE: MentionSuggestion[] = [];

function live(transport: PeopleSearchTransport): boolean {
  // a test fake works without a server; the real one needs it configured
  return transport !== SupabasePeopleSearchTransport || isSupabaseConfigured();
}

/** `value`, once it stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export type PeopleSearchStatus = "short" | "loading" | "error" | "done";

export interface PeopleSearchResult {
  status: PeopleSearchStatus;
  people: MentionSuggestion[];
  retry: () => void;
}

/** The people matching what is typed, once typing pauses. */
export function usePeopleSearch(
  text: string,
  transport: PeopleSearchTransport = SupabasePeopleSearchTransport,
): PeopleSearchResult {
  const account = useAccount();
  const typed = searchPrefix(text);
  const settled = useSettled(typed, SETTLE_MS);
  const prefix = settled !== null && settled === typed ? settled : null;
  const query = useQuery({
    queryKey: ["peopleSearch", account.userId ?? "none", prefix ?? ""],
    queryFn: () => transport.search(prefix as string),
    enabled: prefix !== null && live(transport),
    staleTime: 60_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
  const retry = () => void query.refetch();
  if (typed === null) {
    return { status: "short", people: NONE, retry };
  }
  // Still typing, or asking the server (a retry after an error too).
  if (prefix === null || query.isFetching) {
    return { status: "loading", people: NONE, retry };
  }
  if (query.isError) {
    return { status: "error", people: NONE, retry };
  }
  if (query.data === undefined) {
    return { status: "loading", people: NONE, retry };
  }
  return { status: "done", people: query.data, retry };
}
