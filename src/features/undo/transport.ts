import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { getSupabaseClient } from "@/lib/supabase";
import type { RecentlyDeletedItem } from "./types";

/**
 * "Recently deleted" data access (migration 0053). Restoring goes through the
 * hub transport (comments) and the posts transport (posts), which also power
 * the snackbar Undo; this seam only reads the list.
 */
export interface UndoTransport {
  /** My comments and posts deleted in the last 24 hours, newest first. Throws
   * `unavailable` before the migration is applied. */
  fetchRecentlyDeleted(): Promise<RecentlyDeletedItem[]>;
}

const rowSchema = z.object({
  kind: z.enum(["comment", "post", "post_comment"]),
  item_id: z.string(),
  body: z.string(),
  deleted_at: z.string(),
  expires_at: z.string(),
  hub_id: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  magnitude: z.coerce.number().nullable().optional(),
});

export function parseRecentlyDeleted(data: unknown): RecentlyDeletedItem[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: RecentlyDeletedItem[] = [];
  for (const row of data) {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const deletedAt = Date.parse(parsed.data.deleted_at);
    const expiresAt = Date.parse(parsed.data.expires_at);
    if (Number.isNaN(deletedAt) || Number.isNaN(expiresAt)) {
      continue;
    }
    rows.push({
      kind: parsed.data.kind,
      id: parsed.data.item_id,
      body: parsed.data.body,
      deletedAt,
      expiresAt,
      hubId: parsed.data.hub_id ?? null,
      place: parsed.data.place ?? null,
      magnitude: parsed.data.magnitude ?? null,
    });
  }
  return rows;
}

export const SupabaseUndoTransport: UndoTransport = {
  async fetchRecentlyDeleted() {
    const client = getSupabaseClient();
    if (!client) {
      throw new CommunityError("unavailable", "Supabase is not configured");
    }
    const { data, error } = await client.rpc("my_recently_deleted");
    if (error) {
      throw toCommunityError(error);
    }
    return parseRecentlyDeleted(data);
  },
};
