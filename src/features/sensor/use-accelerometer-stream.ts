import { useFocusEffect } from "expo-router";
import { Accelerometer } from "expo-sensors";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import {
  ACCELEROMETER_UPDATE_INTERVAL_MS,
  MAX_PLOT_POINTS,
  PLOT_RENDER_INTERVAL_MS,
  PLOT_WINDOW_MS,
  RING_BUFFER_CAPACITY,
  WEB_SILENT_TIMEOUT_MS,
} from "./constants";
import { downsampleForPlot, selectWindow } from "./downsample";
import { removeGravityFromSeries } from "./low-pass-filter";
import { RingBuffer } from "./ring-buffer";
import type { AxisKey, AxisVisibility, SensorSample } from "./types";

/**
 * - "checking": availability/permission check in flight (usually sub-frame).
 * - "unavailable": `Accelerometer.isAvailableAsync()` resolved false (some
 *   emulators, a device genuinely missing the sensor), OR — web only — a
 *   subscription was started but never delivered a single sample within
 *   `WEB_SILENT_TIMEOUT_MS` (iOS 12.2–12.4's Settings toggle left off, or a
 *   desktop/Android browser with no real motion hardware; see
 *   `WEB_SILENT_TIMEOUT_MS`'s doc comment).
 * - "permission-denied": the device requires motion-sensor permission and
 *   the user declined it (or it was already denied and can't be re-asked).
 *   On web this also covers browsers with no `requestPermission` API at all
 *   on iOS — `expo-sensors`' web shim reports those as denied outright,
 *   since the only fix is the same Settings toggle, not an in-app re-ask.
 * - "permission-required": web only. iOS Safari (13+) gates DeviceMotion
 *   behind `DeviceMotionEvent.requestPermission()`, which Safari silently
 *   ignores unless it's called from inside a user-gesture handler — so
 *   unlike native, we never auto-request here. The screen shows a button;
 *   `requestWebPermission` (called from that button's `onPress`) is what
 *   actually asks.
 * - "streaming": subscribed and (once the first render tick fires) drawing
 *   live samples.
 */
export type SensorStreamStatus =
  "checking" | "unavailable" | "permission-denied" | "permission-required" | "streaming";

export interface UseAccelerometerStreamResult {
  status: SensorStreamStatus;
  /** Windowed, gravity-processed (per current toggle), downsampled — ready
   * to hand straight to the chart. */
  samples: SensorSample[];
  activeAxes: AxisVisibility;
  toggleAxis: (axis: AxisKey) => void;
  removeGravity: boolean;
  setRemoveGravity: (value: boolean) => void;
  /** Web-only action for the "permission-required" state — must be invoked
   * directly from a `Pressable`'s `onPress` so the browser still sees it as
   * a user gesture by the time the permission prompt fires. A no-op on
   * native platforms. */
  requestWebPermission: () => void;
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
 *
 * Web needs an extra branch: iOS Safari gates `DeviceMotionEvent` behind a
 * permission that can only be requested from a user gesture, so the mount
 * flow can't just ask like native does — see `SensorStreamStatus`'s doc
 * comment for the full state breakdown.
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

  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const renderIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True only while this screen is focused/mounted — the async chains below
  // (native and web) check this after every `await` so a late-resolving
  // promise from a screen the user has already left can never clobber state.
  const activeRef = useRef(false);

  // Set by `requestWebPermission` once `requestPermissionsAsync()` resolves
  // "granted", then consumed (and cleared) the next time the focus effect
  // below runs. We deliberately do NOT subscribe directly from the button's
  // `onPress` promise chain — that would hand ownership of the
  // subscription's cleanup to a closure that isn't the one React actually
  // tears down on blur/unmount, since it was created before the button was
  // ever pressed. Bumping `restartTick` instead makes the *same*
  // `useFocusEffect` run again (and register a fresh, correctly-owned
  // cleanup) with this flag already set.
  const webGrantedRef = useRef(false);
  const [restartTick, setRestartTick] = useState(0);

  const stopStreaming = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    if (renderIntervalRef.current) {
      clearInterval(renderIntervalRef.current);
      renderIntervalRef.current = null;
    }
    if (silentTimeoutRef.current) {
      clearTimeout(silentTimeoutRef.current);
      silentTimeoutRef.current = null;
    }
  }, []);

  const beginStreaming = useCallback(() => {
    buffer.clear();
    setSamples([]);

    Accelerometer.setUpdateInterval(ACCELEROMETER_UPDATE_INTERVAL_MS);
    subscriptionRef.current = Accelerometer.addListener((reading) => {
      buffer.push({
        x: reading.x,
        y: reading.y,
        z: reading.z,
        t: Date.now(),
      });
    });

    setStatus("streaming");

    renderIntervalRef.current = setInterval(() => {
      const raw = buffer.toArray();
      const windowed = selectWindow(raw, Date.now(), PLOT_WINDOW_MS);
      const processed = removeGravityRef.current
        ? removeGravityFromSeries(windowed)
        : windowed;
      setSamples(downsampleForPlot(processed, MAX_PLOT_POINTS));
    }, PLOT_RENDER_INTERVAL_MS);
  }, [buffer]);

  /**
   * Web-only wrapper: starts streaming exactly like native, but also arms a
   * short watchdog (`WEB_SILENT_TIMEOUT_MS`) that demotes the screen back
   * to "unavailable" if the buffer is still empty once it fires — the
   * "listening timeout fallback" `isAvailableAsync()` alone can't cover
   * (see `WEB_SILENT_TIMEOUT_MS`'s doc comment).
   */
  const beginStreamingWeb = useCallback(() => {
    beginStreaming();
    silentTimeoutRef.current = setTimeout(() => {
      if (!activeRef.current) return;
      if (buffer.toArray().length === 0) {
        stopStreaming();
        setStatus("unavailable");
      }
    }, WEB_SILENT_TIMEOUT_MS);
  }, [beginStreaming, buffer, stopStreaming]);

  /**
   * Web-only: called from the "permission-required" state's button
   * `onPress`. Must run synchronously inside the gesture handler up to the
   * `requestPermissionsAsync()` call for Safari to honor it — React event
   * handlers run inside the same browser task as the tap, so this
   * qualifies even though the function itself is `async`-shaped via a
   * promise chain. The actual subscribe happens on the *next* focus-effect
   * run (see `webGrantedRef`/`restartTick` above), not here.
   */
  const requestWebPermission = useCallback(() => {
    if (Platform.OS !== "web") return;

    setStatus("checking");
    Accelerometer.requestPermissionsAsync()
      .then((permission) => {
        if (!activeRef.current) return;
        if (permission.status !== "granted") {
          setStatus("permission-denied");
          return;
        }
        webGrantedRef.current = true;
        setRestartTick((tick) => tick + 1);
      })
      .catch(() => {
        if (activeRef.current) {
          setStatus("permission-denied");
        }
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      activeRef.current = true;

      async function startNative() {
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

        beginStreaming();
      }

      async function startWeb() {
        // Unlike native, we check permission *before* availability: on iOS
        // Safari `isAvailableAsync()` itself waits (up to ~250 ms) for a
        // live event to prove availability, which can never happen before
        // permission is granted — checking availability first would always
        // read "unavailable" and the user would never see a way to grant
        // permission at all.
        const permission = await Accelerometer.getPermissionsAsync();
        if (cancelled) return;

        if (permission.status === "denied") {
          // Either an explicit prior refusal this session, or — per
          // `expo-sensors`' web shim — an iOS browser with no
          // `requestPermission` API at all (iOS 12.2–12.4), which it
          // reports as denied outright since the only fix is the Settings
          // toggle, not an in-app re-ask.
          setStatus("permission-denied");
          return;
        }

        if (permission.status !== "granted") {
          // "undetermined": this browser exposes
          // `DeviceMotionEvent.requestPermission`, which only resolves when
          // called from a user gesture — show the button and wait for a
          // real tap (`requestWebPermission`) instead of asking here.
          // Note `getPermissionsAsync()` reports "undetermined" on this
          // class of browser *unconditionally*, even after a real grant —
          // it can't know without asking — which is why a successful grant
          // is threaded through via `webGrantedRef` instead of ever
          // re-running this check.
          setStatus("permission-required");
          return;
        }

        // Already granted — no permission gate on this browser (e.g.
        // desktop/Android web), or a previous grant earlier this session.
        // Still confirm data actually shows up before calling it
        // "streaming": `isAvailableAsync()` reports "available"
        // unconditionally on non-iOS web, so it can't be trusted alone.
        const available = await Accelerometer.isAvailableAsync();
        if (cancelled) return;
        if (!available) {
          setStatus("unavailable");
          return;
        }

        beginStreamingWeb();
      }

      // A grant from the web "enable" button bumped `restartTick` to get us
      // re-invoked here — go straight to streaming instead of re-running
      // the permission checks (which, on a browser with a
      // `requestPermission` API, would just read "undetermined" again
      // forever; see `startWeb`'s doc comment below).
      if (webGrantedRef.current) {
        webGrantedRef.current = false;
        beginStreamingWeb();
        return () => {
          cancelled = true;
          activeRef.current = false;
          stopStreaming();
          buffer.clear();
          setSamples([]);
        };
      }

      setStatus("checking");
      buffer.clear();
      setSamples([]);

      void (Platform.OS === "web" ? startWeb() : startNative());

      return () => {
        cancelled = true;
        activeRef.current = false;
        stopStreaming();
        buffer.clear();
        setSamples([]);
      };
      // `buffer`/`beginStreaming`/`beginStreamingWeb`/`stopStreaming` are all
      // stable identities for the component's lifetime, included only to
      // satisfy exhaustive-deps — none of them ever causes this effect to
      // re-run in practice. `restartTick` is the one deliberate exception:
      // bumping it (see `requestWebPermission`) is what makes this effect
      // run again after a web permission grant, its value is never read.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- restartTick is intentionally unread, only its identity change matters
    }, [buffer, beginStreaming, beginStreamingWeb, stopStreaming, restartTick]),
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
    requestWebPermission,
  };
}
