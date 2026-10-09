import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { eventHubKeys } from "@/features/eventhub/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SupabaseContentFilterTransport, type ContentFilterTransport } from "./transport";
import type { ContentHold, FilterKind, FilterLang, SurgeMode } from "./types";

const NOT_PERSISTED = { persist: false } as const;

export const contentFilterKeys = {
  all: ["contentfilter"] as const,
  terms: ["contentfilter", "terms"] as const,
  surge: ["contentfilter", "surge"] as const,
  surgeActive: ["contentfilter", "surge-active"] as const,
  holds: (kind: "comment" | "post" | "post_comment", ids: readonly string[]) =>
    ["contentfilter", "holds", kind, ids.join(",")] as const,
};

/** Busy-time review is on: the Event hub explains why a new account's comment
 * waits. Cheap and public; re-read every few minutes at most. */
export function useSurgeActive(
  transport: ContentFilterTransport = SupabaseContentFilterTransport,
) {
  const query = useQuery({
    queryKey: contentFilterKeys.surgeActive,
    queryFn: () => transport.fetchSurgeActive(),
    enabled: isSupabaseConfigured(),
    staleTime: 5 * 60_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
  return query.data === true;
}

/** Why the listed comments or posts wait for review (moderators only), as a
 * map from id to its holds. Empty while loading, on error, or without ids. */
export function useHolds(
  kind: "comment" | "post" | "post_comment",
  ids: readonly string[],
  enabled: boolean,
  transport: ContentFilterTransport = SupabaseContentFilterTransport,
): Record<string, ContentHold[]> {
  const sorted = [...ids].sort();
  const query = useQuery({
    queryKey: contentFilterKeys.holds(kind, sorted),
    queryFn: () => transport.fetchHolds(kind, sorted),
    enabled: enabled && sorted.length > 0 && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
  const map: Record<string, ContentHold[]> = {};
  for (const hold of query.data ?? []) {
    (map[hold.targetId] ??= []).push(hold);
  }
  return map;
}

export function useFilterTerms(
  enabled: boolean,
  transport: ContentFilterTransport = SupabaseContentFilterTransport,
) {
  return useQuery({
    queryKey: contentFilterKeys.terms,
    queryFn: () => transport.fetchTerms(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export function useSurgeStatus(
  enabled: boolean,
  transport: ContentFilterTransport = SupabaseContentFilterTransport,
) {
  return useQuery({
    queryKey: contentFilterKeys.surge,
    queryFn: () => transport.fetchSurgeStatus(),
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export interface ContentFilterActions {
  addTerm: (term: string, lang: FilterLang, kind: FilterKind) => Promise<string>;
  setTermActive: (termId: string, active: boolean) => Promise<void>;
  setSurgeMode: (mode: SurgeMode) => Promise<void>;
  approvePost: (postId: string) => Promise<void>;
  pinComment: (commentId: string) => Promise<void>;
  unpinComment: (commentId: string) => Promise<void>;
}

export function useContentFilterActions(
  transport: ContentFilterTransport = SupabaseContentFilterTransport,
): ContentFilterActions {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: contentFilterKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["admin"] }),
    ]);
  const refreshHub = () => queryClient.invalidateQueries({ queryKey: eventHubKeys.all });

  const addTerm = useMutation({
    mutationFn: (input: { term: string; lang: FilterLang; kind: FilterKind }) =>
      transport.addTerm(input.term, input.lang, input.kind),
    onSuccess: refresh,
  });
  const setTermActive = useMutation({
    mutationFn: (input: { termId: string; active: boolean }) =>
      transport.setTermActive(input.termId, input.active),
    onSuccess: refresh,
  });
  const setSurgeMode = useMutation({
    mutationFn: (mode: SurgeMode) => transport.setSurgeMode(mode),
    onSuccess: refresh,
  });
  const approvePost = useMutation({
    mutationFn: (postId: string) => transport.approvePost(postId),
    onSuccess: refresh,
  });
  const pinComment = useMutation({
    mutationFn: (commentId: string) => transport.pinComment(commentId),
    onSuccess: refreshHub,
  });
  const unpinComment = useMutation({
    mutationFn: (commentId: string) => transport.unpinComment(commentId),
    onSuccess: refreshHub,
  });

  return {
    addTerm: (term, lang, kind) => addTerm.mutateAsync({ term, lang, kind }),
    setTermActive: (termId, active) => setTermActive.mutateAsync({ termId, active }),
    setSurgeMode: async (mode) => {
      await setSurgeMode.mutateAsync(mode);
    },
    approvePost: (postId) => approvePost.mutateAsync(postId),
    pinComment: (commentId) => pinComment.mutateAsync(commentId),
    unpinComment: (commentId) => unpinComment.mutateAsync(commentId),
  };
}
