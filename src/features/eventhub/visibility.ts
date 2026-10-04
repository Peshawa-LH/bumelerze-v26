/** How recent an event must be for its hub entry to show with no activity yet. */
export const HUB_RECENT_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface HubPillInput {
  isRegional: boolean;
  /** Event origin time, UTC ms. */
  originTime: number;
  nowMs: number;
  /** Null while the summary is unknown (loading, offline, or no registry). */
  summary: { reports: number; comments: number; featured?: boolean } | null;
}

/**
 * The "Who felt it?" pill shows for a regional event that either already has
 * activity (reports + comments > 0) or is recent enough (within 72 hours)
 * that people are still arriving to say what they felt.
 */
export function shouldShowHubPill({
  isRegional,
  originTime,
  nowMs,
  summary,
}: HubPillInput): boolean {
  if (!isRegional) {
    return false;
  }
  if (summary?.featured) {
    return true;
  }
  if (summary !== null && summary.reports + summary.comments > 0) {
    return true;
  }
  return nowMs - originTime <= HUB_RECENT_WINDOW_MS;
}
