import { ROLE_BADGES, type BadgeTone, type IconName } from "./catalog";
import type { BadgeEntry } from "./evaluate";

/** Glyph and tone to draw for an entry in its current state. */
export function entryVisual(entry: BadgeEntry): { glyph: IconName; tone: BadgeTone } {
  if (entry.kind === "role") {
    const role = ROLE_BADGES[entry.role];
    return { glyph: role.icon, tone: role.tone };
  }
  const { badge } = entry;
  return {
    glyph: entry.earned ? badge.icon : badge.iconOutline,
    tone: badge.tone,
  };
}
