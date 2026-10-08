import { toCommunityError } from "@/features/community/transport";
import { CommunityError } from "@/features/community/types";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * "Download my data" (migration 0061): `export_my_data()` returns one JSON
 * document of everything the signed-in person gave Bumelerze. The server
 * decides what is in it (the caller's own rows only); the app only saves it.
 */
export interface DataExportTransport {
  fetchMyData(): Promise<unknown>;
}

export const SupabaseDataExportTransport: DataExportTransport = {
  async fetchMyData() {
    const client = getSupabaseClient();
    if (!client) {
      throw new CommunityError("unavailable", "Supabase is not configured");
    }
    const { data, error } = await client.rpc("export_my_data");
    if (error) {
      throw toCommunityError(error);
    }
    if (data === null || typeof data !== "object") {
      throw new CommunityError("unknown", "export_my_data: unexpected result");
    }
    return data;
  },
};

/** `bumelerze-my-data-2026-10-09.json` (the UTC date of the export). */
export function exportFileName(now: number = Date.now()): string {
  return `bumelerze-my-data-${new Date(now).toISOString().slice(0, 10)}.json`;
}

/** Pretty-printed, so the person can read it in any text editor. */
export function exportText(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}
