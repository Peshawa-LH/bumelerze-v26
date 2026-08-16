import { getSupabaseClient } from "@/lib/supabase";
import { FELT_CELL_ROW_COLUMNS, parseFeltCellRows, type FeltCellRow } from "./types";

/**
 * Small transport seam (same shape/spirit as `features/felt/queue.ts`'s
 * `FeltTransport`) so `useFeltMap` never talks to `@supabase/supabase-js`
 * directly — tests inject a fixture-backed `FeltMapTransport` instead of
 * mocking the Supabase client's query-builder chain.
 */
export interface FeltMapTransport {
  fetchFeltCells(eventId: string): Promise<FeltCellRow[]>;
}

/**
 * The real transport, wired the moment a Supabase project exists
 * (`isSupabaseConfigured()` — `lib/supabase.ts`). Reads only
 * `felt_cells_public` (supabase/migrations/0004_felt_cells.sql) — the view
 * itself enforces the >=3-report display threshold and the latest-version-
 * only rule, so this query is a plain unfiltered select on `event_id`.
 */
export const SupabaseFeltMapTransport: FeltMapTransport = {
  async fetchFeltCells(eventId: string): Promise<FeltCellRow[]> {
    const client = getSupabaseClient();
    if (!client) {
      // Defensive only — `useFeltMap` gates the query itself on
      // `isSupabaseConfigured()`, so this branch shouldn't run in practice.
      // Matches `SupabaseTransport`'s own "nothing was attempted" fallback
      // rather than a confusing throw for a state the caller already
      // guarded against.
      return [];
    }

    const { data, error } = await client
      .from("felt_cells_public")
      .select(FELT_CELL_ROW_COLUMNS.join(", "))
      .eq("event_id", eventId);

    if (error) {
      // No silent catches (repo rule) — rethrown so React Query's `isError`
      // path drives `useFeltMap`'s offline/failure state.
      throw error;
    }

    return parseFeltCellRows(data ?? []).rows;
  },
};
