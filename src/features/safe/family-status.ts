import { DISPLAY_WINDOW_MS } from "./constants";
import type { FamilyCheckIn, FamilyCheckIns } from "./transport";

/**
 * Family status of one home, as plain data (design note 5.5). Pure: the
 * screen and the Profile chip both read it.
 *
 * - The FOCUS earthquake is the latest one (by origin time) that somebody in
 *   the home checked in for during the last 24 hours. No focus, no chip.
 * - A member is "safe" when their newest check-in is from the last 24 hours
 *   AND was made after the focus earthquake (a check-in after a later
 *   aftershock counts, whichever event it was tied to).
 * - "before": they checked in within 24 hours, but before the focus
 *   earthquake (greyed: "Before the 14:21 earthquake").
 * - "earlier": their newest check-in is older than 24 hours (greyed).
 * - "none": nothing heard. Neutral wording, never "missing".
 * Never a location, a distance, a "last seen" or a read receipt.
 */

export type MemberCheckInState = "safe" | "before" | "earlier" | "none";

export interface MemberStatus {
  userId: string;
  state: MemberCheckInState;
  checkin: FamilyCheckIn | null;
}

export interface FamilyStatusSummary {
  focus: FamilyCheckIn["event"] | null;
  members: MemberStatus[];
  checkedIn: number;
  total: number;
}

export function summarizeFamilyStatus(
  data: FamilyCheckIns,
  now: number = Date.now(),
): FamilyStatusSummary {
  const recent = data.checkins.filter((c) => now - c.checkedInAt <= DISPLAY_WINDOW_MS);
  let focus: FamilyCheckIn["event"] | null = null;
  for (const c of recent) {
    if (!focus || c.event.originTime > focus.originTime) {
      focus = c.event;
    }
  }

  const newestByUser = new Map<string, FamilyCheckIn>();
  for (const c of data.checkins) {
    const known = newestByUser.get(c.userId);
    if (!known || c.checkedInAt > known.checkedInAt) {
      newestByUser.set(c.userId, c);
    }
  }

  const members: MemberStatus[] = data.sharing.map((userId) => {
    const checkin = newestByUser.get(userId) ?? null;
    let state: MemberCheckInState = "none";
    if (checkin) {
      if (now - checkin.checkedInAt > DISPLAY_WINDOW_MS) {
        state = "earlier";
      } else if (focus && checkin.checkedInAt < focus.originTime) {
        state = "before";
      } else {
        state = "safe";
      }
    }
    return { userId, state, checkin };
  });

  return {
    focus,
    members,
    checkedIn: members.filter((m) => m.state === "safe").length,
    total: members.length,
  };
}
