import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { parseSuggestions, type MentionSuggestion } from "@/features/mentions/transport";
import { getSupabaseClient, signInAnonymously } from "@/lib/supabase";

/**
 * Profile > Find people. It reuses the mention list's server function
 * (`mention_suggestions`, migration 0063): any session may call it (an
 * account, or a guest's anonymous session), it returns public profile fields
 * only (name, @username, photo, and whether you follow each other), people
 * you follow first, then everyone with a public profile; never a private
 * account you cannot see, a blocked or a suspended one. Screens never call
 * Supabase directly; tests inject a fake.
 */
export interface PeopleSearchTransport {
  /** At most 8 people whose name or @username starts with `prefix`. */
  search(prefix: string): Promise<MentionSuggestion[]>;
}

export const SupabasePeopleSearchTransport: PeopleSearchTransport = {
  async search(prefix) {
    const client = getSupabaseClient();
    if (!client) {
      throw new CommunityError("unavailable", "Supabase is not configured");
    }
    // The function answers sessions only: a guest who never sent anything
    // yet gets its anonymous session here, as for comments and feedback.
    try {
      await signInAnonymously();
    } catch (error) {
      throw toCommunityError(error);
    }
    const { data, error } = await client.rpc("mention_suggestions", {
      p_prefix: prefix,
    });
    if (error) {
      throw toCommunityError(error);
    }
    return parseSuggestions(data);
  },
};
