import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { isSupabaseConfigured } from "@/lib/supabase";
import {
  PHOTO_PAGE_SIZE,
  SupabasePhotoQueueTransport,
  type PhotoQueueTransport,
  type PhotoStatus,
} from "./transport";

/** Photos people sent: never written to the on-device cache. */
const NOT_PERSISTED = { persist: false } as const;

export const photoKeys = {
  all: ["admin", "photos"] as const,
  queue: (status: PhotoStatus) => ["admin", "photos", "queue", status] as const,
  signed: (paths: readonly string[]) =>
    ["admin", "photos", "signed", paths.join("|")] as const,
};

export function usePhotoQueue(
  status: PhotoStatus,
  enabled: boolean,
  transport: PhotoQueueTransport = SupabasePhotoQueueTransport,
) {
  return useInfiniteQuery({
    queryKey: photoKeys.queue(status),
    queryFn: ({ pageParam }) => transport.queue(status, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.length >= PHOTO_PAGE_SIZE
        ? (lastPage[lastPage.length - 1]?.cursor ?? null)
        : null,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 15_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

/** Ten-minute links for the photos on screen, refreshed after five. A
 * rejected photo whose file is gone simply has no link. */
export function useSignedPhotos(
  paths: readonly string[],
  transport: PhotoQueueTransport = SupabasePhotoQueueTransport,
) {
  return useQuery({
    queryKey: photoKeys.signed(paths),
    queryFn: async () =>
      new Map((await transport.sign([...paths])).map((e) => [e.path, e.url])),
    enabled: paths.length > 0 && isSupabaseConfigured(),
    staleTime: 5 * 60_000,
    retry: 0,
    meta: NOT_PERSISTED,
  });
}

export interface PhotoActions {
  approve: (photoId: string) => Promise<void>;
  /** Marks the photo rejected, then removes its file. Resolves with false when
   * the decision was saved but the file could not be removed yet (rejecting
   * again retries the removal). */
  reject: (photoId: string, reason: string | null) => Promise<boolean>;
}

export function usePhotoActions(
  transport: PhotoQueueTransport = SupabasePhotoQueueTransport,
): PhotoActions {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });
  const approve = useMutation({
    mutationFn: async (photoId: string) => {
      await transport.moderate(photoId, "approve", null);
    },
    onSuccess: refresh,
  });
  const reject = useMutation({
    mutationFn: async (input: { photoId: string; reason: string | null }) => {
      const result = await transport.moderate(input.photoId, "reject", input.reason);
      try {
        await transport.removeFile(result.storagePath);
        return true;
      } catch {
        return false;
      }
    },
    onSettled: refresh,
  });
  return {
    approve: (photoId) => approve.mutateAsync(photoId),
    reject: (photoId, reason) => reject.mutateAsync({ photoId, reason }),
  };
}
