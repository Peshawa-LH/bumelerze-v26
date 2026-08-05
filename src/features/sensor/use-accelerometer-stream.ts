import { useFocusEffect } from "expo-router";
import { Accelerometer } from "expo-sensors";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ACCELEROMETER_UPDATE_INTERVAL_MS,
  MAX_PLOT_POINTS,
  PLOT_RENDER_INTERVAL_MS,
  PLOT_WINDOW_MS,
  RING_BUFFER_CAPACITY,
} from "./constants";
import { downsampleForPlot, selectWindow } from "./downsample";
import { removeGravityFromSeries } from "./low-pass-filter";
import { RingBuffer } from "./ring-buffer";
import type { AxisKey, AxisVisibility, SensorSample } from "./types";

/**
 * - "checking": availability/permission check in flight (usually sub-frame).
 * - "unavailable": `Accelerometer.isAvailableAsync()` resolved false (web,
 *   some emulators, a device genuinely missing the sensor).
 * - "permission-denied": the device requires motion-sensor permission and
 *   the user declined it (or it was already denied and can't be re-asked).
 * - "streaming": subscribed and (once the first render tick fires) drawing
 *   live samples.
 */
export type SensorStreamStatus =
  "checking" | "unavailable" | "permission-denied" | "streaming";

export interface UseAccelerometerStreamResult {
  status: SensorStreamStatus;
  /** Windowed, gravity-processed (per current toggle), downsampled — ready
   * to hand straight to the chart. */
  samples: SensorSample[];
  activeAxes: AxisVisibility;
  toggleAxis: (axis: AxisKey) => void;
  removeGravity: boolean;
  setRemoveGravity: (value: boolean) => void;
}

const ALL_AXES_VISIBLE: AxisVisibility = { x: true, y: true, z: true };

/**
 * Streams live accelerometer samples while, and only while, the Sensor
 * screen is focused (`useFocusEffect` — unsubscribes on blur/unmount, no
 * background sensing per D11/feature-matrix A6 and the app's
 * battery-conscious hard requirement).
 *
 * Split into two independent cadences on purpose:
 *  1. The native listener callback (up to ~50 Hz) only pushes into a
 *     `RingBuffer` ref — zero React state writes, so it can run as fast as
 *     the OS delivers events without ever forcing a re-render.
 *  2. A separate interval, throttled to `PLOT_RENDER_INTERVAL_MS`
 *     (~30 fps), reads the buffer, applies the current time window +
 *     gravity toggle + point-count downsampling, and commits exactly one
 *     `setSamples` per tick. This is the "throttled state update" half of
 *     the wave brief's "do NOT setState at 50 Hz" requirement.
 */
export function useAccelerometerStream(): UseAccelerometerStreamResult {
  const [status, setStatus] = useState<SensorStreamStatus>("checking");
  const [samples, setSamples] = useState<SensorSample[]>([]);
  const [activeAxes, setActiveAxes] = useState<AxisVisibility>(ALL_AXES_VISIBLE);
  const [removeGravity, setRemoveGravity] = useState(false);

  // Read inside the render-tick interval without needing to tear the
  // interval down and restart it every time the user flips the toggle.
  // Synced via an effect (never written during render — refs must only be
  // read/written in effects/handlers, not render, per the React Compiler's
  // react-hooks/refs rule).
  const removeGravityRef = useRef(removeGravity);
  useEffect(() => {
    removeGravityRef.current = removeGravity;
  }, [removeGravity]);

  // Lazy one-time init via useState (not a ref mutated during render, which
  // the same rule above forbids even for the common "if (!ref.current)"
  // idiom) — the buffer instance itself is intentionally mutable, we only
  // need a stable identity across renders.
  const [buffer] = useState(() => new RingBuffer<SensorSample>(RING_BUFFER_CAPACITY));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let subscription: { remove: () => void } | null = null;
      let renderInterval: ReturnType<typeof setInterval> | null = null;

      async function start() {
        setStatus("checking");
        buffer.clear();
        setSamples([]);

        const available = await Accelerometer.isAvailableAsync();
        if (cancelled) return;
        if (!available) {
          setStatus("unavailable");
          return;
        }

        // iOS gates some Core Motion access behind a runtime permission on
        // certain OS versions; Android has no equivalent gate for the plain
        // accelerometer. `expo-sensors` exposes the same permission API for
        // every sensor type regardless of whether a given platform actually
        // enforces it — asking here is a harmless no-op where it isn't
        // required, and correct where it is.
        let permission = await Accelerometer.getPermissionsAsync();
        if (cancelled) return;
        if (permission.status !== "granted" && permission.canAskAgain) {
          permission = await Accelerometer.requestPermissionsAsync();
          if (cancelled) return;
        }
        if (permission.status !== "granted") {
          setStatus("permission-denied");
          return;
        }

        Accelerometer.setUpdateInterval(ACCELEROMETER_UPDATE_INTERVAL_MS);
        subscription = Accelerometer.addListener((reading) => {
          buffer.push({
            x: reading.x,
            y: reading.y,
            z: reading.z,
            t: Date.now(),
          });
        });

        setStatus("streaming");

        renderInterval = setInterval(() => {
          const raw = buffer.toArray();
          const windowed = selectWindow(raw, Date.now(), PLOT_WINDOW_MS);
          const processed = removeGravityRef.current
            ? removeGravityFromSeries(windowed)
            : windowed;
          setSamples(downsampleForPlot(processed, MAX_PLOT_POINTS));
        }, PLOT_RENDER_INTERVAL_MS);
      }

      void start();

      return () => {
        cancelled = true;
        subscription?.remove();
        if (renderInterval) {
          clearInterval(renderInterval);
        }
        buffer.clear();
        setSamples([]);
      };
      // `buffer` is a stable identity for the component's lifetime (lazy
      // `useState` init above never re-runs), included only to satisfy
      // exhaustive-deps — it never causes this effect to re-run in practice.
    }, [buffer]),
  );

  const toggleAxis = useCallback((axis: AxisKey) => {
    setActiveAxes((previous) => ({ ...previous, [axis]: !previous[axis] }));
  }, []);

  return {
    status,
    samples,
    activeAxes,
    toggleAxis,
    removeGravity,
    setRemoveGravity,
  };
}
