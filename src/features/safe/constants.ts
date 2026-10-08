/**
 * "I'm safe" check-in v1 (design note im-safe-design-2026-10-08, D78/D79/D80).
 * Every tunable of the feature lives here so it can be changed in one place.
 */

/**
 * When does a strong earthquake ask "Are you safe?" on Home?
 *
 * Conservative "expected felt intensity at least EMS-98 V" by magnitude and
 * epicentral distance: an event qualifies when its magnitude reaches a row's
 * `minMagnitude` and the phone is within that row's `withinKm`. The test runs
 * ON THE DEVICE against the phone's own last fix; the location is never sent.
 *
 * Owner confirmed the intensity bar (V) on 2026-10-08 (D14 review). The
 * distance table is the design note's default (section 5.1). Replace it
 * with the engine's GMPE intensity at the device point once an event has a
 * SHAKEmap product.
 */
export const EXPECTED_INTENSITY_V_TABLE: readonly {
  readonly minMagnitude: number;
  readonly withinKm: number;
}[] = [
  { minMagnitude: 7.0, withinKm: 400 },
  { minMagnitude: 6.5, withinKm: 250 },
  { minMagnitude: 6.0, withinKm: 150 },
  { minMagnitude: 5.5, withinKm: 80 },
  { minMagnitude: 5.0, withinKm: 40 },
  { minMagnitude: 4.5, withinKm: 20 },
];

/** After a felt report: level V and up gets the big "I'm safe" button; III-IV
 * a quiet "Let your family know" link; II and below nothing. EMS-98 levels
 * (the felt cartoons are the 12 EMS-98 degrees). */
export const FELT_PRIMARY_MIN_LEVEL = 5;
export const FELT_QUIET_MIN_LEVEL = 3;

/** Home banner: only for earthquakes of the last 6 hours. */
export const BANNER_WINDOW_MS = 6 * 60 * 60_000;

/** Manual check-in (Family screen, Profile): only while a regional earthquake
 * of at least M4.0 from the last 72 hours exists; otherwise "Practice" (not
 * stored, not shared). Avoids a daily "are you alive" heartbeat. The server
 * refuses events older than 72 hours too. */
export const MANUAL_MIN_MAGNITUDE = 4.0;
export const MANUAL_WINDOW_MS = 72 * 60 * 60_000;

/** After a check-in or "Not now", stay quiet for 3 hours unless a new event
 * is at least one table row (0.5 magnitude) stronger. */
export const QUIET_PERIOD_MS = 3 * 60 * 60_000;
export const STRONGER_BY_MAGNITUDE = 0.5;

/** Family status: a check-in counts as current for 24 hours; older ones show
 * greyed under "Earlier". The server returns the last 7 days only. */
export const DISPLAY_WINDOW_MS = 24 * 60 * 60_000;

/** Undo stays on screen for 10 seconds. */
export const UNDO_MS = 10_000;

/** Local copies of sent check-ins are forgotten after 30 days, like the
 * server rows. */
export const LOCAL_RETENTION_MS = 30 * 24 * 60 * 60_000;
