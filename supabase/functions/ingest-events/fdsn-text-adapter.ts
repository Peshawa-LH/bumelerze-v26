// Shared Deno-only glue for the two FDSN-text channels (GEOFON, ISC):
// fetch -> split into lines -> zod-validate each parsed row -> normalize.
// The line-splitting and per-field coercion themselves live in the pure,
// Jest-tested `normalize-fdsn-text.ts`; this file adds the network call and
// the zod re-validation pass (`fdsn-text-schema.ts`), matching
// usgs-adapter.ts/emsc-adapter.ts's own I/O-vs-pure-logic split.

import { fetchTextWithRetry, isEmptyFeedBody } from "./http.ts";
import {
  normalizeFdsnTextRow,
  parseFdsnTextLine,
  type NormalizeFdsnTextOptions,
} from "./normalize-fdsn-text.ts";
import { fdsnTextRowSchema } from "./fdsn-text-schema.ts";
import type { ChannelFetchResult, ChannelId } from "./types.ts";

export interface FdsnTextChannelOptions extends NormalizeFdsnTextOptions {
  channel: ChannelId;
  url: string;
  timeoutMs: number;
}

export async function fetchFdsnTextChannel(
  options: FdsnTextChannelOptions,
): Promise<ChannelFetchResult> {
  const text = await fetchTextWithRetry(options.url, { timeoutMs: options.timeoutMs });

  const records: ChannelFetchResult["records"] = [];
  let skippedCount = 0;

  // A 204 / blank body ("no matching events", the usual GEOFON answer for
  // this region) falls through the loop below as zero records; it is only
  // flagged so the log can tell it from a list with zero parseable rows.
  const emptyBody = isEmptyFeedBody(text);

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const row = parseFdsnTextLine(line);
    if (row === null) {
      skippedCount += 1;
      continue;
    }

    const validated = fdsnTextRowSchema.safeParse(row);
    if (!validated.success) {
      skippedCount += 1;
      continue;
    }

    const record = normalizeFdsnTextRow(validated.data, {
      provider: options.provider,
      defaultReviewStatus: options.defaultReviewStatus,
    });
    if (record === null) {
      skippedCount += 1;
      continue;
    }
    records.push(record);
  }

  return { channel: options.channel, records, skippedCount, emptyBody };
}
