import { z } from "zod";

/**
 * Tolerant zod schemas for the two Supabase read surfaces
 * `normalizeSupabaseEventRow` (`normalize.ts`) turns into an `Event` —
 * mirrors `usgs-schema.ts`/`emsc-schema.ts`/`geofon-schema.ts`'s own split
 * (schema lives beside its fetch module, `supabase-event.ts`; the pure
 * row -> `Event` mapping lives in `normalize.ts` alongside every other
 * provider's normalizer, same "normalize at the boundary" convention).
 */

/** `public.events_with_sources` (migration 0023), the app's one anon-
 * readable read shape for a canonical event by its `bumelerze_id`. */
export const eventsWithSourcesRowSchema = z.object({
  event_id: z.string().min(1),
  bumelerze_id: z.string().min(1).nullable(),
  origin_time: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  depth_km: z.number().nullable(),
  magnitude: z.number(),
  mag_type: z.string().nullable(),
  place: z.string().nullable(),
  updated_at: z.string(),
});
export type EventsWithSourcesRow = z.infer<typeof eventsWithSourcesRowSchema>;

/** `public.event_source_records` (migration 0023), the earliest-seen
 * provider sighting for a canonical event — provenance for
 * `normalizeSupabaseEventRow`'s `Event.provenance`/`Event.id`. */
export const primarySourceRowSchema = z.object({
  provider: z.string().min(1),
  provider_event_id: z.string().min(1),
  fetched_at: z.string(),
});
export type PrimarySourceRow = z.infer<typeof primarySourceRowSchema>;
