import { z } from "zod";

import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * Mentions data access (migration 0063). `lookup` says which @names belong to
 * an account the viewer may open (links); `suggest` lists people for the
 * composer (people I follow or who follow me first, never a private account
 * I cannot see, never anybody in a block with me, never a suspended
 * account). Both are harmless before the migration: they answer "nothing".
 * Screens never call Supabase directly; tests inject a fake.
 */
export interface MentionSuggestion {
  userId: string;
  username: string;
  displayName: string | null;
  avatarPath: string | null;
  relation: "following" | "follower" | "other";
}

export interface MentionsTransport {
  /** The lower-case names among `names` (at most 50) that exist. */
  lookup(names: readonly string[]): Promise<string[]>;
  /** At most 8 people for a typed prefix (2 to 24 characters). */
  suggest(prefix: string): Promise<MentionSuggestion[]>;
}

/** Names per lookup call (the server reads at most 50). */
export const LOOKUP_CHUNK = 50;

const suggestionSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  display_name: z.string().nullable().optional(),
  avatar_path: z.string().nullable().optional(),
  relation: z.enum(["following", "follower", "other"]).catch("other"),
});

export function parseSuggestions(data: unknown): MentionSuggestion[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const rows: MentionSuggestion[] = [];
  for (const row of data) {
    const parsed = suggestionSchema.safeParse(row);
    if (parsed.success) {
      rows.push({
        userId: parsed.data.user_id,
        username: parsed.data.username,
        displayName: parsed.data.display_name ?? null,
        avatarPath: parsed.data.avatar_path ?? null,
        relation: parsed.data.relation,
      });
    }
  }
  return rows;
}

async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
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

function quietly<T>(fallback: T) {
  return (error: unknown): T => {
    // Before migration 0063 there are no mentions: plain text, no list.
    if (error instanceof CommunityError && error.code === "unavailable") {
      return fallback;
    }
    throw error;
  };
}

export const SupabaseMentionsTransport: MentionsTransport = {
  async lookup(names) {
    if (names.length === 0) {
      return [];
    }
    const data = await call("mention_lookup", {
      p_names: names.slice(0, LOOKUP_CHUNK),
    }).catch(quietly<unknown>([]));
    return Array.isArray(data)
      ? data.filter((name): name is string => typeof name === "string")
      : [];
  },

  async suggest(prefix) {
    const data = await call("mention_suggestions", { p_prefix: prefix }).catch(
      quietly<unknown>([]),
    );
    return parseSuggestions(data);
  },
};
