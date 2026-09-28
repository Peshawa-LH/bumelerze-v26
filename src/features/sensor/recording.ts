/**
 * Phone accelerometer recordings (owner, 2026-09-27): press Record, keep
 * a fixed window of raw samples, save them as a plain text file with a
 * header a person or a script can read. Raw = what the phone delivered,
 * gravity included, in g; linear = the same after the gravity filter.
 */

export interface RecordedSample {
  /** Unix ms when the sample was received. */
  t: number;
  rawX: number;
  rawY: number;
  rawZ: number;
  linX: number;
  linY: number;
  linZ: number;
}

export interface SensorRecording {
  startedAt: number;
  endedAt: number;
  requestedMs: number;
  samples: RecordedSample[];
}

export interface RecordingMeta {
  appVersion: string;
  platform: string;
  device: string;
  locale: string;
}

export interface RecordingSummary {
  durationS: number;
  count: number;
  measuredHz: number;
  peakLinearG: number;
}

export const RECORDING_DURATIONS_MS = [10_000, 30_000, 60_000] as const;
export const STANDARD_GRAVITY_MS2 = 9.80665;

export function summarizeRecording(recording: SensorRecording): RecordingSummary {
  const first = recording.samples[0];
  const last = recording.samples[recording.samples.length - 1];
  const spanS =
    first && last && recording.samples.length > 1 ? (last.t - first.t) / 1000 : 0;
  let peak = 0;
  for (const s of recording.samples) {
    peak = Math.max(peak, Math.hypot(s.linX, s.linY, s.linZ));
  }
  return {
    durationS: (recording.endedAt - recording.startedAt) / 1000,
    count: recording.samples.length,
    measuredHz: spanS > 0 ? (recording.samples.length - 1) / spanS : 0,
    peakLinearG: peak,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function recordingFileName(startedAt: number): string {
  const d = new Date(startedAt);
  return `bumelerze-accel-${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}-${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z.txt`;
}

/**
 * The file: a `#`-commented header (who, when, how many, units, columns)
 * followed by one row per sample, tab-separated, time relative to the
 * first sample and absolute UTC. Reads straight into pandas/numpy with
 * `comment="#"`.
 */
export function buildRecordingText(
  recording: SensorRecording,
  meta: RecordingMeta,
): string {
  const summary = summarizeRecording(recording);
  const first = recording.samples[0];
  const t0 = first ? first.t : recording.startedAt;
  const header = [
    "# Bumelerze — phone accelerometer recording",
    `# app_version: ${meta.appVersion}`,
    `# platform: ${meta.platform}`,
    `# device: ${meta.device}`,
    `# locale: ${meta.locale}`,
    `# started_utc: ${new Date(recording.startedAt).toISOString()}`,
    `# ended_utc: ${new Date(recording.endedAt).toISOString()}`,
    `# requested_duration_s: ${(recording.requestedMs / 1000).toFixed(0)}`,
    `# samples: ${summary.count}`,
    `# measured_sample_rate_hz: ${summary.measuredHz.toFixed(2)}`,
    `# peak_linear_acceleration_g: ${summary.peakLinearG.toFixed(4)}`,
    `# units: acceleration in g (1 g = ${STANDARD_GRAVITY_MS2} m/s^2); axes are the phone's own (x across, y along, z out of the screen)`,
    "# raw_* = as delivered by the phone, gravity included; lin_* = gravity removed by a first-order low-pass (alpha 0.8)",
    "# sample times are the moment each sample reached the app, not the sensor's own clock",
    "# columns: t_s\tutc_iso\traw_x_g\traw_y_g\traw_z_g\tlin_x_g\tlin_y_g\tlin_z_g",
  ];
  const rows = recording.samples.map((s) =>
    [
      ((s.t - t0) / 1000).toFixed(3),
      new Date(s.t).toISOString(),
      s.rawX.toFixed(5),
      s.rawY.toFixed(5),
      s.rawZ.toFixed(5),
      s.linX.toFixed(5),
      s.linY.toFixed(5),
      s.linZ.toFixed(5),
    ].join("\t"),
  );
  return [...header, ...rows].join("\n") + "\n";
}
