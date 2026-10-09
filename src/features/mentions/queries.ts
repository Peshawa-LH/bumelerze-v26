import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useAccount } from "@/features/account/use-account";
import { isSupabaseConfigured } from "@/lib/supabase";
import { batcherFor } from "./lookup";
import { SUGGEST_MIN_CHARS } from "./parse";
import {
  SupabaseMentionsTransport,
  type MentionSuggestion,
  type MentionsTransport,
} from "./transport";

/** Who may be linked depends on the viewer (blocks), so nothing is written
 * to the on-device cache. */
const NOT_PERSISTED = { persist: false } as const;
const EMPTY: ReadonlySet<string> = new Set();
const NONE: MentionSuggestion[] = [];

function live(transport: MentionsTransport): boolean {
  // a test fake works without a server; the real one needs it configured
  return transport !== SupabaseMentionsTransport || isSupabaseConfigured();
}

/** The names among `names` that belong to an account the viewer may open.
 * Empty while loading or offline: the text then reads as plain text. */
export function useKnownMentions(
  names: readonly string[],
  transport: MentionsTransport = SupabaseMentionsTransport,
): ReadonlySet<string> {
  const account = useAccount();
  const key = [...names].sort().join(",");
  const query = useQuery({
    queryKey: ["mentions", "known", account.userId ?? "none", key],
    queryFn: () => batcherFor(transport).resolve(key.split(",")),
    enabled: key !== "" && live(transport),
    staleTime: 5 * 60_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
  return query.data ?? EMPTY;
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

/** People to suggest for the "@…" being typed (null: nothing is typed). */
export function useMentionSuggestions(
  query: string | null,
  transport: MentionsTransport = SupabaseMentionsTransport,
): MentionSuggestion[] {
  const account = useAccount();
  const settled = useSettled(query, 250);
  const prefix = settled !== null && settled === query ? settled.toLowerCase() : null;
  const result = useQuery({
    queryKey: ["mentions", "suggest", account.userId ?? "none", prefix ?? ""],
    queryFn: () => transport.suggest(prefix as string),
    enabled:
      prefix !== null &&
      prefix.length >= SUGGEST_MIN_CHARS &&
      account.userId !== null &&
      live(transport),
    staleTime: 60_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
  return query === null ? NONE : (result.data ?? NONE);
}
