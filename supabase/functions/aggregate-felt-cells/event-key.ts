// Pure request-shape classification for this function's "which event(s)"
// input — deliberately dependency-free (no zod, no supabase-js) so it can
// be unit-tested under Jest exactly like `aggregate-event.ts`/
// `cell-extras.ts` already are (see that file's own doc: "these tests
// exercise the surrounding decision logic instead"). `index.ts` still runs
// the raw body through a zod schema first for basic type/format checking
// (uuid shape, non-empty strings, sinceHours bounds) — this module only
// owns the CROSS-FIELD decision of which of the three supported request
// shapes was sent and whether they're used consistently.
//
// Migration 0011 fix: the caller (`felt_reports.event_id` resolution on the
// client, and now this function too) may only have a (provider,
// provider_event_id) pair in hand rather than the canonical event uuid —
// mirrors `event_source_records`' own identity key (migration 0002).

export const DEFAULT_SWEEP_LOOKBACK_HOURS = 24;

export type EventKeyRequest =
  | { mode: "single-by-id"; eventId: string }
  | { mode: "single-by-provider"; provider: string; providerEventId: string }
  | { mode: "sweep"; sinceHours: number };

export interface RawAggregateRequestFields {
  eventId?: string;
  provider?: string;
  providerEventId?: string;
  sinceHours?: number;
}

export type ClassifyResult =
  | { ok: true; request: EventKeyRequest }
  | { ok: false; reason: string };

/**
 * Classifies a validated (zod-passed) request body into exactly one of the
 * three supported modes, enforcing the cross-field rules zod's per-field
 * checks can't express on their own:
 *  - `provider` and `providerEventId` must be supplied together (either
 *    both or neither) — a lone one of the pair is always a caller mistake.
 *  - `eventId` and `provider`/`providerEventId` are mutually exclusive —
 *    sending both is ambiguous about which identity wins, so it's rejected
 *    rather than silently picking one.
 *  - Neither present -> sweep mode (unchanged default behavior), defaulting
 *    `sinceHours` the same way `index.ts` always has.
 */
export function classifyAggregateRequest(
  fields: RawAggregateRequestFields,
): ClassifyResult {
  const hasEventId = fields.eventId !== undefined;
  const hasProvider = fields.provider !== undefined;
  const hasProviderEventId = fields.providerEventId !== undefined;

  if (hasProvider !== hasProviderEventId) {
    return {
      ok: false,
      reason: "provider and providerEventId must be supplied together",
    };
  }
  if (hasEventId && hasProvider) {
    return {
      ok: false,
      reason: "eventId and provider/providerEventId are mutually exclusive",
    };
  }
  if (hasEventId) {
    // deno-lint-ignore no-non-null-assertion -- hasEventId already proved this
    return { ok: true, request: { mode: "single-by-id", eventId: fields.eventId! } };
  }
  if (hasProvider) {
    return {
      ok: true,
      request: {
        mode: "single-by-provider",
        // deno-lint-ignore no-non-null-assertion -- hasProvider/hasProviderEventId already proved these
        provider: fields.provider!,
        // deno-lint-ignore no-non-null-assertion
        providerEventId: fields.providerEventId!,
      },
    };
  }
  return {
    ok: true,
    request: { mode: "sweep", sinceHours: fields.sinceHours ?? DEFAULT_SWEEP_LOOKBACK_HOURS },
  };
}
