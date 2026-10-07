import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { useAccount } from "@/features/account/use-account";
import { isSupabaseConfigured } from "@/lib/supabase";
import { dropQueuedHomePhotos, useQueuedPhotoCount } from "./photo-queue";
import { saveSurveyAndAssessment } from "./service";
import type { Answers } from "./questionnaire";
import { SupabaseHomeTransport, type HomeTransport } from "./transport";
import type {
  DeleteHomeResult,
  HomeMember,
  HomePhoto,
  HomeTag,
  JoinResult,
  MemberRole,
  StoredAssessment,
  StoredSurvey,
} from "./types";

/**
 * React Query hooks for the home tags. Every query is keyed by the signed-in
 * user and marked `persist: false`: exact locations, answers and join keys
 * must never be written to the on-device query cache (the root layout skips
 * queries with that flag). They live in memory only.
 */

const HOME_STALE_MS = 30_000;
const NO_PERSIST = { persist: false } as const;

export const homeKeys = {
  all: ["home"] as const,
  mine: (userId: string) => ["home", "mine", userId] as const,
  detail: (userId: string, tagId: string) => ["home", "detail", userId, tagId] as const,
  survey: (userId: string, tagId: string) => ["home", "survey", userId, tagId] as const,
  photos: (userId: string, tagId: string, queued = 0) =>
    ["home", "photos", userId, tagId, queued] as const,
  family: (userId: string, tagId: string) => ["home", "family", userId, tagId] as const,
};

export interface HomeSummary {
  tag: HomeTag;
  role: MemberRole;
  assessment: StoredAssessment | null;
}

export interface MyHomes {
  homes: HomeSummary[];
  /** Join requests this account sent that the owner has not answered yet. */
  pendingRequests: number;
}

export async function loadMyHomes(
  transport: HomeTransport,
  userId: string,
): Promise<MyHomes> {
  const memberships = await transport.fetchMemberships(userId);
  const approved = memberships.filter((member) => member.status === "approved");
  const pendingRequests = memberships.length - approved.length;
  const tags = (await transport.fetchTags(approved.map((member) => member.tagId))).filter(
    (tag) => tag.status === "active",
  );
  const assessments = await transport.fetchLatestAssessments(
    tags.map((tag) => tag.tagId),
  );
  const homes = tags
    .map((tag) => ({
      tag,
      role: approved.find((member) => member.tagId === tag.tagId)?.role ?? "member",
      assessment: assessments[tag.tagId] ?? null,
    }))
    .sort((a, b) => a.tag.createdAt.localeCompare(b.tag.createdAt));
  return { homes, pendingRequests };
}

interface Identity {
  userId: string | null;
  enabled: boolean;
}

function useIdentity(): Identity {
  const account = useAccount();
  return {
    userId: account.userId,
    enabled:
      isSupabaseConfigured() && account.status === "account" && account.userId !== null,
  };
}

export interface UseMyHomesResult {
  data: MyHomes | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export function useMyHomes(
  transport: HomeTransport = SupabaseHomeTransport,
): UseMyHomesResult {
  const { userId, enabled } = useIdentity();
  const query = useQuery({
    queryKey: homeKeys.mine(userId ?? ""),
    queryFn: () => loadMyHomes(transport, userId as string),
    enabled,
    staleTime: HOME_STALE_MS,
    meta: NO_PERSIST,
  });
  return {
    data: query.data ?? null,
    isLoading: enabled && query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export interface HomeDetail {
  tag: HomeTag | null;
  role: MemberRole | null;
  assessment: StoredAssessment | null;
}

export async function loadHome(
  transport: HomeTransport,
  userId: string,
  tagId: string,
): Promise<HomeDetail> {
  const [tags, memberships, assessments] = await Promise.all([
    transport.fetchTags([tagId]),
    transport.fetchMemberships(userId),
    transport.fetchLatestAssessments([tagId]),
  ]);
  const membership = memberships.find(
    (member) => member.tagId === tagId && member.status === "approved",
  );
  return {
    tag: tags[0] ?? null,
    role: membership?.role ?? null,
    assessment: assessments[tagId] ?? null,
  };
}

export interface UseHomeResult {
  data: HomeDetail | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export function useHome(
  tagId: string | undefined,
  transport: HomeTransport = SupabaseHomeTransport,
): UseHomeResult {
  const { userId, enabled } = useIdentity();
  const on = enabled && !!tagId;
  const query = useQuery({
    queryKey: homeKeys.detail(userId ?? "", tagId ?? ""),
    queryFn: () => loadHome(transport, userId as string, tagId as string),
    enabled: on,
    staleTime: HOME_STALE_MS,
    meta: NO_PERSIST,
  });
  return {
    data: query.data ?? null,
    isLoading: on && query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** The latest survey of a home, to prefill a retake. */
export function useLatestSurvey(
  tagId: string | undefined,
  transport: HomeTransport = SupabaseHomeTransport,
): { survey: StoredSurvey | null; isLoading: boolean } {
  const { userId, enabled } = useIdentity();
  const on = enabled && !!tagId;
  const query = useQuery({
    queryKey: homeKeys.survey(userId ?? "", tagId ?? ""),
    queryFn: () => transport.fetchLatestSurvey(tagId as string),
    enabled: on,
    staleTime: HOME_STALE_MS,
    meta: NO_PERSIST,
  });
  return { survey: query.data ?? null, isLoading: on && query.isLoading };
}

/** The home's photos with signed links; empty while loading or on any error.
 * The count of photos still waiting in the upload queue is part of the key,
 * so the list reloads each time one finishes uploading. */
export function useHomePhotos(
  tagId: string | undefined,
  transport: HomeTransport = SupabaseHomeTransport,
): HomePhoto[] {
  const { userId, enabled } = useIdentity();
  const queued = useQueuedPhotoCount(tagId);
  const query = useQuery({
    queryKey: homeKeys.photos(userId ?? "", tagId ?? "", queued),
    queryFn: () => transport.fetchPhotos(tagId as string),
    enabled: enabled && !!tagId,
    // Signed links last an hour; refetch well before they would expire.
    staleTime: 30 * 60_000,
    meta: NO_PERSIST,
    retry: false,
  });
  return query.data ?? [];
}

export interface FamilyData {
  members: HomeMember[];
  names: Record<string, string>;
  /** The secret join key; owners only. */
  joinKey: string | null;
}

export async function loadFamily(
  transport: HomeTransport,
  tagId: string,
  isOwner: boolean,
): Promise<FamilyData> {
  const [members, joinKey] = await Promise.all([
    transport.fetchMembers(tagId),
    isOwner ? transport.fetchJoinKey(tagId) : Promise.resolve(null),
  ]);
  const names = await transport.fetchDisplayNames(members.map((member) => member.userId));
  return { members, names, joinKey };
}

export function useFamily(
  tagId: string | undefined,
  isOwner: boolean,
  transport: HomeTransport = SupabaseHomeTransport,
): { data: FamilyData | null; isLoading: boolean; isError: boolean } {
  const { userId, enabled } = useIdentity();
  const on = enabled && !!tagId;
  const query = useQuery({
    queryKey: [
      ...homeKeys.family(userId ?? "", tagId ?? ""),
      isOwner ? "owner" : "member",
    ],
    queryFn: () => loadFamily(transport, tagId as string, isOwner),
    enabled: on,
    staleTime: 10_000,
    meta: NO_PERSIST,
  });
  return {
    data: query.data ?? null,
    isLoading: on && query.isLoading,
    isError: query.isError,
  };
}

function refreshHomes(queryClient: QueryClient): Promise<unknown> {
  return queryClient.invalidateQueries({ queryKey: homeKeys.all });
}

export interface HomeActions {
  join: (code: string, key: string) => Promise<JoinResult>;
  decide: (tagId: string, userId: string, approve: boolean) => Promise<void>;
  leave: (tagId: string) => Promise<void>;
  /** Owner only: deletes the home for everyone (photos, report, family). */
  deleteHome: (tagId: string) => Promise<DeleteHomeResult>;
  rotateKey: (tagId: string) => Promise<string>;
  retake: (tag: HomeTag, answers: Answers) => Promise<void>;
  /** Re-read everything (after a create). */
  refresh: () => Promise<unknown>;
}

/** Write actions. Each refreshes the home queries on success and rejects
 * with a `HomeError` for the caller to word. */
export function useHomeActions(
  transport: HomeTransport = SupabaseHomeTransport,
): HomeActions {
  const queryClient = useQueryClient();

  const join = useMutation({
    mutationFn: ({ code, key }: { code: string; key: string }) =>
      transport.requestJoin(code, key),
    onSuccess: () => refreshHomes(queryClient),
  });
  const decide = useMutation({
    mutationFn: (input: { tagId: string; userId: string; approve: boolean }) =>
      transport.decideJoin(input.tagId, input.userId, input.approve),
    onSuccess: () => refreshHomes(queryClient),
  });
  const leave = useMutation({
    mutationFn: (tagId: string) => transport.leave(tagId),
    onSuccess: () => refreshHomes(queryClient),
  });
  const deleteHome = useMutation({
    mutationFn: (tagId: string) => transport.deleteHome(tagId),
    onSuccess: (_result, tagId) => {
      dropQueuedHomePhotos(tagId);
      // The home's own queries would only fail now: drop them rather than
      // refetch, then re-read the rest (the My home card goes empty).
      queryClient.removeQueries({
        predicate: (query) =>
          query.queryKey[0] === "home" &&
          query.queryKey.length > 3 &&
          query.queryKey[3] === tagId,
      });
      // The server-side "family linked" count can change with it.
      void queryClient.invalidateQueries({ queryKey: ["account", "stats"] });
      return refreshHomes(queryClient);
    },
  });
  const rotate = useMutation({
    mutationFn: (tagId: string) => transport.rotateKey(tagId),
    onSuccess: () => refreshHomes(queryClient),
  });
  const retake = useMutation({
    mutationFn: async ({ tag, answers }: { tag: HomeTag; answers: Answers }) => {
      await saveSurveyAndAssessment(tag.tagId, { lat: tag.lat, lon: tag.lon }, answers, {
        transport,
      });
    },
    onSuccess: () => refreshHomes(queryClient),
  });

  return {
    join: (code, key) => join.mutateAsync({ code, key }),
    decide: (tagId, userId, approve) => decide.mutateAsync({ tagId, userId, approve }),
    leave: (tagId) => leave.mutateAsync(tagId),
    deleteHome: (tagId) => deleteHome.mutateAsync(tagId),
    rotateKey: (tagId) => rotate.mutateAsync(tagId),
    retake: (tag, answers) => retake.mutateAsync({ tag, answers }),
    refresh: () => refreshHomes(queryClient),
  };
}
