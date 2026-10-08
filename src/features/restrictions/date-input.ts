import { toAsciiDigits } from "@/lib/format-numbers";
import { DAY_MS } from "./types";

/** The farthest end date the server takes (10 years). */
const MAX_DAYS = 3650;

/**
 * "2026-11-30" (Latin or Eastern Arabic-Indic digits, `-` or `/`) -> the end of
 * that local day as an ISO timestamp, or null when it is not a real date, not
 * in the future, or beyond 10 years.
 */
export function parseEndDate(text: string, nowMs: number): string | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(toAsciiDigits(text.trim()));
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const end = new Date(year, month - 1, day, 23, 59, 59);
  if (
    end.getFullYear() !== year ||
    end.getMonth() !== month - 1 ||
    end.getDate() !== day
  ) {
    return null;
  }
  const at = end.getTime();
  // a minute of grace over the server's "must be in the future"
  if (at <= nowMs + 2 * 60_000 || at > nowMs + (MAX_DAYS - 1) * DAY_MS) {
    return null;
  }
  return end.toISOString();
}
