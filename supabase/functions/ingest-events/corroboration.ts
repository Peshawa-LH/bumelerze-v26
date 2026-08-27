// Pure mirror of `public.events_with_sources`' `corroboration_count`
// (migration 0023): "how many independent agencies located this", counting
// DISTINCT (author_agency, falling back to the upper-cased provider tag
// when a source carries no author_agency). Not called by production code
// (the real number the app reads comes from the SQL view, which runs once
// per query rather than once per ingest for every event) — this exists so
// the counting RULE itself is unit-tested and kept in sync with the SQL
// view's own `coalesce(esr.author_agency, upper(esr.provider))` expression,
// the same "port + cross-reference + test" idiom `matching.ts`/
// `derivation.ts` already use for their own SQL-mirrored logic.

import type { StoredSourceRecord } from "./types.ts";

export function corroborationCount(
  sourceRecords: readonly Pick<StoredSourceRecord, "provider" | "authorAgency" | "reviewStatus">[],
): number {
  const agencies = new Set<string>();
  for (const record of sourceRecords) {
    if (record.reviewStatus === "deleted") {
      continue;
    }
    agencies.add((record.authorAgency ?? record.provider).toUpperCase());
  }
  return agencies.size;
}
