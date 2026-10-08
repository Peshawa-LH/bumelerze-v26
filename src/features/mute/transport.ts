import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * Mute (migration 0061): hide one person's comments and posts for me only.
 * Quiet: the muted person is not told and nothing changes on their side.
 * Tests inject a fake `MuteTransport`.
 */
export interface MutedPerson {
  userId: string;
  /** Null for a guest (no profile) or someone without a @username. */
  username: string | null;
  displayName: string | null;
  avatarPath: string | null;
}

export interface MuteTransport {
  /** Throws `unavailable` before the migration is applied. */
  fetchMuted(): Promise<MutedPerson[]>;
  mute(userId: string): Promise<void>;
  unmute(userId: string): Promise<void>;
}

const rowSchema = z.object({
  person_id: z.string(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  avatar_path: z.string().nullable().optional(),
});

export function parseMutedRows(data: unknown): MutedPerson[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const people: MutedPerson[] = [];
  for (const row of data) {
    const parsed = rowSchema.safeParse(row);
    if (parsed.success) {
      people.push({
        userId: parsed.data.person_id,
        username: parsed.data.username ?? null,
        displayName: parsed.data.display_name ?? null,
        avatarPath: parsed.data.avatar_path ?? null,
      });
    }
  }
  return people;
}

async function call(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const client = getSupabaseClient();
  if (!client) {
    throw new CommunityError("unavailable", "Supabase is not configured");
  }
  const { data, error } = await client.rpc(name, args);
  if (error) {
    throw toCommunityError(error);
  }
  return data;
}

export const SupabaseMuteTransport: MuteTransport = {
  async fetchMuted() {
    return parseMutedRows(await call("my_mutes"));
  },
  async mute(userId) {
    await call("mute_user", { p_user: userId });
  },
  async unmute(userId) {
    await call("unmute_user", { p_user: userId });
  },
};
