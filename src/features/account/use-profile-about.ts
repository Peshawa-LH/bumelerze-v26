import { useQuery } from "@tanstack/react-query";

import { isSupabaseConfigured } from "@/lib/supabase";
import { loadProfileAbout, type AboutLoad } from "./about";

export const profileAboutKey = (userId: string) => ["account", "about", userId] as const;

/**
 * The owner's bio, city and name-change allowance for Edit profile. Never
 * written to the on-device cache (it changes with every save). `loading`
 * until the first answer; a failure counts as `unavailable` so the form
 * still opens (without the bio and city fields).
 */
export function useProfileAbout(
  userId: string | null,
  load: () => Promise<AboutLoad> = loadProfileAbout,
): AboutLoad | { status: "loading" } {
  const query = useQuery({
    queryKey: profileAboutKey(userId ?? "none"),
    queryFn: load,
    enabled: isSupabaseConfigured() && userId !== null,
    staleTime: 0,
    retry: 1,
    meta: { persist: false },
  });
  if (!isSupabaseConfigured() || userId === null) {
    return { status: "unavailable" };
  }
  if (query.isLoading) {
    return { status: "loading" };
  }
  if (query.isError || !query.data) {
    return { status: "unavailable" };
  }
  return query.data;
}
