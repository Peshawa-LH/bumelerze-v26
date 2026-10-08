import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { getSupabaseClient } from "@/lib/supabase";

/** The private bucket felt-report photos live in (migration 0016). */
export const FELT_PHOTOS_BUCKET = "felt-photos";
const SIGNED_URL_SECONDS = 600;
export const PHOTO_PAGE_SIZE = 30;

export const PHOTO_STATUSES = ["pending", "approved", "rejected"] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];

/** One photo in the queue (`admin_felt_photo_queue()`, migration 0060). The
 * server never returns a coordinate, a geohash, a device id or the sender;
 * `storagePath` is only for asking Storage for a short-lived link. */
export interface QueuePhoto {
  id: string;
  storagePath: string;
  status: PhotoStatus;
  /** Raw server timestamp: the cursor for the next page. */
  cursor: string;
  /** When the photo arrived, UTC ms. */
  createdAt: number;
  /** When the felt report was made, UTC ms. */
  reportedAt: number | null;
  /** The EMS-98 level the person picked (1-12). */
  intensity: number | null;
  /** Event hub route id (`bml...`), or null for a report with no event. */
  hubId: string | null;
  place: string | null;
  magnitude: number | null;
  originTime: number | null;
  moderatedAt: number | null;
  moderatedByName: string | null;
}

export interface ModerateResult {
  status: PhotoStatus;
  storagePath: string;
}

export interface PhotoQueueTransport {
  /** One page. Pending: oldest first. Approved / rejected: newest decision first. */
  queue(status: PhotoStatus, cursor: string | null): Promise<QueuePhoto[]>;
  sign(paths: string[]): Promise<{ path: string; url: string }[]>;
  moderate(
    photoId: string,
    action: "approve" | "reject",
    reason: string | null,
  ): Promise<ModerateResult>;
  /** Removes a rejected photo's file (the storage policy allows nothing else). */
  removeFile(path: string): Promise<void>;
}

function ms(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const str = z.string().nullable().optional();
const optNum = z.coerce.number().nullable().optional().catch(null);

const rowSchema = z.object({
  photo_id: z.string(),
  storage_path: z.string(),
  status: z.enum(PHOTO_STATUSES),
  created_at: z.string(),
  report_created_at: str,
  intensity: optNum,
  hub_id: str,
  place: str,
  magnitude: optNum,
  origin_time: str,
  moderated_at: str,
  moderated_by_name: str,
});

export function parseQueuePhotos(data: unknown): QueuePhoto[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const out: QueuePhoto[] = [];
  for (const raw of data) {
    const parsed = rowSchema.safeParse(raw);
    const createdAt = parsed.success ? ms(parsed.data.created_at) : null;
    if (!parsed.success || createdAt === null) {
      continue;
    }
    const d = parsed.data;
    out.push({
      id: d.photo_id,
      storagePath: d.storage_path,
      status: d.status,
      // pending pages on arrival time, the others on decision time
      cursor: d.status === "pending" ? d.created_at : (d.moderated_at ?? d.created_at),
      createdAt,
      reportedAt: ms(d.report_created_at),
      intensity: d.intensity ?? null,
      hubId: d.hub_id ?? null,
      place: d.place ?? null,
      magnitude: d.magnitude ?? null,
      originTime: ms(d.origin_time),
      moderatedAt: ms(d.moderated_at),
      moderatedByName: d.moderated_by_name ?? null,
    });
  }
  return out;
}

const resultSchema = z.object({
  status: z.enum(PHOTO_STATUSES),
  storage_path: z.string(),
});

export function parseModerateResult(data: unknown): ModerateResult {
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) {
    throw new CommunityError("unknown", "bad moderation result");
  }
  return { status: parsed.data.status, storagePath: parsed.data.storage_path };
}

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new CommunityError("unavailable", "Supabase is not configured");
  }
  return client;
}

async function call(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await requireClient().rpc(name, args);
  if (error) {
    throw toCommunityError(error);
  }
  return data;
}

export const SupabasePhotoQueueTransport: PhotoQueueTransport = {
  async queue(status, cursor) {
    return parseQueuePhotos(
      await call("admin_felt_photo_queue", {
        p_status: status,
        p_cursor: cursor,
        p_limit: PHOTO_PAGE_SIZE,
      }),
    );
  },
  async sign(paths) {
    if (paths.length === 0) {
      return [];
    }
    const { data, error } = await requireClient()
      .storage.from(FELT_PHOTOS_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error) {
      throw toCommunityError(error);
    }
    const out: { path: string; url: string }[] = [];
    for (const entry of data ?? []) {
      if (entry.signedUrl && entry.path) {
        out.push({ path: entry.path, url: entry.signedUrl });
      }
    }
    return out;
  },
  async moderate(photoId, action, reason) {
    return parseModerateResult(
      await call("admin_felt_photo_moderate", {
        p_photo_id: photoId,
        p_action: action,
        p_reason: reason,
      }),
    );
  },
  async removeFile(path) {
    const { error } = await requireClient()
      .storage.from(FELT_PHOTOS_BUCKET)
      .remove([path]);
    if (error) {
      throw toCommunityError(error);
    }
  },
};
