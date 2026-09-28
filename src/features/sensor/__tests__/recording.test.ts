import { buildRecordingText, recordingFileName, summarizeRecording } from "../recording";

const T0 = Date.parse("2026-09-27T20:15:03.120Z");
const recording = {
  startedAt: T0,
  endedAt: T0 + 2000,
  requestedMs: 2000,
  samples: [0, 20, 40, 60, 80].map((ms, i) => ({
    t: T0 + ms,
    rawX: 0.01 * i,
    rawY: 0,
    rawZ: 1,
    linX: 0.01 * i,
    linY: 0,
    linZ: 0,
  })),
};

describe("sensor recording", () => {
  it("summarises duration, count, measured rate and peak", () => {
    const s = summarizeRecording(recording);
    expect(s.durationS).toBe(2);
    expect(s.count).toBe(5);
    expect(s.measuredHz).toBeCloseTo(50, 5);
    expect(s.peakLinearG).toBeCloseTo(0.04, 5);
  });

  it("copes with an empty recording", () => {
    const s = summarizeRecording({ ...recording, samples: [] });
    expect(s).toEqual({ durationS: 2, count: 0, measuredHz: 0, peakLinearG: 0 });
  });

  it("names the file by the UTC start", () => {
    expect(recordingFileName(T0)).toBe("bumelerze-accel-20260927-201503Z.txt");
  });

  it("writes a commented header, units, and one tab-separated row per sample", () => {
    const text = buildRecordingText(recording, {
      appVersion: "26.1.0",
      platform: "web",
      device: "test",
      locale: "ckb",
    });
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe("# Bumelerze — phone accelerometer recording");
    expect(lines).toContain("# app_version: 26.1.0");
    expect(lines).toContain("# samples: 5");
    expect(lines).toContain("# measured_sample_rate_hz: 50.00");
    expect(
      lines.some((l) => l.startsWith("# units: acceleration in g (1 g = 9.80665 m/s^2)")),
    ).toBe(true);
    expect(lines).toContain(
      "# columns: t_s\tutc_iso\traw_x_g\traw_y_g\traw_z_g\tlin_x_g\tlin_y_g\tlin_z_g",
    );
    const rows = lines.filter((l) => !l.startsWith("#"));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toBe(
      "0.000\t2026-09-27T20:15:03.120Z\t0.00000\t0.00000\t1.00000\t0.00000\t0.00000\t0.00000",
    );
    expect(rows[4]?.startsWith("0.080\t2026-09-27T20:15:03.200Z\t0.04000")).toBe(true);
  });
});
