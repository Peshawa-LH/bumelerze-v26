import { useFocusEffect } from "expo-router";
import { Accelerometer } from "expo-sensors";
import { useCallback, useRef, useState } from "react";
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
import { GravityFilter } from "./low-pass-filter";
import { RingBuffer } from "./ring-buffer";
import type { SensorSample } from "./types";

/**
 * - "checking": availability/permission check in flight (usually sub-frame).
 * - "unavailable": `Accelerometer.isAvailableAsync()` resolved false (some
 *   emulators, a device genuinely missing the sensor), OR — web only — a
 *   subscription was started but never delivered a single sample within
 *   `WEB_SILENT_TIMEOUT_MS` (iOS 12.2–12.4's Settings toggle left off, or a
 *   desktop/Android browser with no real motion hardware; see
 *   `WEB_SILENT_TIMEOUT_MS`'s doc comment). Also where any permission/
 *   subscribe call in this hook throws or rejects unexpectedly — see
 *   `hasWebMotionPermissionApi`'s doc comment for why we never trust a
 *   single signal (library-derived status or feature-detection alone) to
 *   decide whether it's safe to show the "enable" button.
 * - "permission-denied": the device requires motion-sensor permission and
 *   the user explicitly declined it this session (web) or the OS reports it
 *   denied with no further ask possible (native).
 * - "permission-required": web only, and only once `hasWebMotionPermissionApi`
 *   has confirmed `DeviceMotionEvent.requestPermission` genuinely exists —
 *   iOS Safari (13+) gates DeviceMotion behind that call, which Safari
 *   silently ignores unless it's called from inside a user-gesture handler,
 *   so unlike native we never auto-request here. The screen shows a button;
 *   `requestWebPermission` (called from that button's `onPress`) is what
 *   actually asks. Browsers where the API is absent (old iOS with no
 *   re-ask, or a browser that never gated motion at all) never reach this
 *   state — see `startWeb`.
 * - "streaming": subscribed and (once the first render tick fires) drawing
 *   live samples.
 */
export type SensorStreamStatus =
  | "checking"
  | "unavailable"
  | "permission-denied"
  | "permission-required"
  | "streaming"
  /** Web only: a browser with no touch points at all — a desktop. Nothing
   * here can ever stream, and on Safari the permission API still EXISTS,
   * so without this the screen offered an "Enable motion sensor" button
   * whose tap could never succeed (owner, 2026-09-27: "the only tab I have
   * not been able to see work"). The screen says: open this on a phone. */
  | "desktop";

export interface UseAccelerometerStreamResult {
  status: SensorStreamStatus;
  /** Windowed, gravity-removed, downsampled — ready to hand straight to
   * either figure. Gravity is always removed (owner, 2026-09-27: every
   * channel centred on zero, amplitudes only), by one filter that runs
   * per sample at ingestion, so the trace never shows a warm-up ramp. */
  samples: SensorSample[];
  /** Web-only action for the "permission-required" state — must be invoked
   * directly from a `Pressable`'s `onPress` so the browser still sees it as
   * a user gesture by the time the permission prompt fires. A no-op on
   * native platforms. */
  requestWebPermission: () => void;
}

/** Standard gravity, m/s² per g. `SensorSample` is in g (native
 * `expo-sensors` reports g); `devicemotion` reports m/s². */
const G_MS2 = 9.80665;

/**
 * True when this browser reports no touch points — a desktop, where no
 * motion hardware exists. Checked only on web; `navigator.maxTouchPoints`
 * is the one signal that is a capability rather than a UA guess.
 */
function isDesktopBrowser(): boolean {
  if (Platform.OS !== "web") return false;
  const nav = (globalThis as { navigator?: { maxTouchPoints?: number } }).navigator;
  return typeof nav?.maxTouchPoints === "number" && nav.maxTouchPoints === 0;
}

/**
 * Web accelerometer source: the browser's own `devicemotion` event,
 * `accelerationIncludingGravity` in m/s², converted to g.
 *
 * NOT `expo-sensors`' web Accelerometer. That shim listens to
 * `deviceorientation` and returns the tilt angles alpha/beta/gamma scaled
 * by pi/180 (read from the installed package's own
 * `ExponentAccelerometer.web.js`, 2026-09-27) — an orientation, not an
 * acceleration. A phone lying flat on a shaking table barely changes tilt
 * while its acceleration swings hard; for a "your phone is a seismometer"
 * screen that is the wrong physical quantity. `accelerationIncludingGravity`
 * matches native semantics, where the gravity toggle's low-pass filter
 * then does its job the same way on both platforms.
 */
function addWebMotionListener(
  onSample: (sample: { x: number; y: number; z: number }) => void,
): { remove: () => void } {
  const target = globalThis as unknown as {
    addEventListener?: (type: string, cb: (e: unknown) => void) => void;
    removeEventListener?: (type: string, cb: (e: unknown) => void) => void;
  };
  const handler = (e: unknown) => {
    const acc = (
      e as {
        accelerationIncludingGravity?: {
          x: number | null;
          y: number | null;
          z: number | null;
        } | null;
      }
    ).accelerationIncludingGravity;
    if (!acc || acc.x == null || acc.y == null || acc.z == null) return;
    onSample({ x: acc.x / G_MS2, y: acc.y / G_MS2, z: acc.z / G_MS2 });
  };
  target.addEventListener?.("devicemotion", handler);
  return { remove: () => target.removeEventListener?.("devicemotion", handler) };
}

/**
 * Direct feature-detection for the web permission-request API, independent
 * of `expo-sensors`' own derived permission status (which infers "does this
 * browser gate motion behind a permission" from UA sniffing internally, and
 * can misfire — see the crash this guards against below). Reads
 * `DeviceMotionEvent` off `globalThis` rather than `window` so it's equally
 * safe on native (where the identifier is simply never defined) and in Jest
 * (`globalThis` there too, no DOM needed).
 *
 * `false` covers two very different browsers the same way on purpose: a
 * desktop/Android browser that never gated motion at all (nothing to ask —
 * the Android-Chrome case), and an iOS Safari old enough (<13) that motion
 * access is an on/off toggle in Settings with no in-app re-ask possible at
 * all. Neither has anything for a button to usefully do, so both fall
 * through to the same "does data actually arrive" availability probe
 * instead of ever reaching the `permission-required` (button-shown) state —
 * see `startWeb` below.
 */
function hasWebMotionPermissionApi(): boolean {
  const motionEventCtor = (
    globalThis as { DeviceMotionEvent?: { requestPermission?: unknown } }
  ).DeviceMotionEvent;
  return typeof motionEventCtor?.requestPermission === "function";
}

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
  // Lazy one-time init via useState (not a ref mutated during render, which
  // the same rule above forbids even for the common "if (!ref.current)"
  // idiom) — the buffer instance itself is intentionally mutable, we only
  // need a stable identity across renders.
  const [buffer] = useState(() => new RingBuffer<SensorSample>(RING_BUFFER_CAPACITY));
  // One gravity filter per stream, applied to every sample as it arrives.
  // The first version re-ran the filter from scratch over the visible
  // window on every render tick, so the window's first second was always
  // the filter warming up — a ramp that slid along as the window moved.
  const [gravity] = useState(() => new GravityFilter());

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

  /**
   * Returns whether the subscription actually started. `setUpdateInterval`/
   * `addListener` are plain synchronous calls (no promise to reject), but
   * per the "never throw out of this hook" rule they're still guarded —
   * a broken/half-shimmed sensor module on some device or test double
   * should demote the screen to "unavailable", not take down the tree.
   */
  const beginStreaming = useCallback((): boolean => {
    buffer.clear();
    gravity.reset();
    setSamples([]);
    const push = (reading: { x: number; y: number; z: number }) => {
      buffer.push({ ...gravity.apply(reading), t: Date.now() });
    };

    try {
      if (Platform.OS === "web") {
        // See `addWebMotionListener`: real acceleration, not the shim's tilt.
        subscriptionRef.current = addWebMotionListener(push);
      } else {
        Accelerometer.setUpdateInterval(ACCELEROMETER_UPDATE_INTERVAL_MS);
        subscriptionRef.current = Accelerometer.addListener(push);
      }
    } catch {
      return false;
    }

    setStatus("streaming");

    renderIntervalRef.current = setInterval(() => {
      const raw = buffer.toArray();
      const windowed = selectWindow(raw, Date.now(), PLOT_WINDOW_MS);
      setSamples(downsampleForPlot(windowed, MAX_PLOT_POINTS));
    }, PLOT_RENDER_INTERVAL_MS);

    return true;
  }, [buffer, gravity]);

  /**
   * Web-only wrapper: starts streaming exactly like native, but also arms a
   * short watchdog (`WEB_SILENT_TIMEOUT_MS`) that demotes the screen back
   * to "unavailable" if the buffer is still empty once it fires — the
   * "listening timeout fallback" `isAvailableAsync()` alone can't cover
   * (see `WEB_SILENT_TIMEOUT_MS`'s doc comment).
   */
  const beginStreamingWeb = useCallback(() => {
    if (!beginStreaming()) {
      setStatus("unavailable");
      return;
    }
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
    // `requestPermissionsAsync()` is documented/typed as always returning a
    // promise, but this is the one call path a real device (the owner's
    // older iOS Safari) has been observed to break in ways a type signature
    // doesn't rule out — guard the synchronous call itself, not just the
    // `.then()` chain, so a genuine synchronous throw here can never
    // escape the tap handler and take the tree down with it.
    try {
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
    } catch {
      if (activeRef.current) {
        setStatus("permission-denied");
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      activeRef.current = true;

      async function startNative() {
        // Every awaited call below is wrapped so a native module that
        // throws or rejects (a device/emulator missing the module, a
        // permission-plugin misconfiguration, etc.) demotes the screen to
        // "unavailable" instead of throwing out of this effect — see the
        // hook's top-level doc comment.
        try {
          const available = await Accelerometer.isAvailableAsync();
          if (cancelled) return;
          if (!available) {
            setStatus("unavailable");
            return;
          }

          // iOS gates some Core Motion access behind a runtime permission on
          // certain OS versions; Android has no equivalent gate for the
          // plain accelerometer. `expo-sensors` exposes the same permission
          // API for every sensor type regardless of whether a given
          // platform actually enforces it — asking here is a harmless
          // no-op where it isn't required, and correct where it is.
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

          if (!beginStreaming()) {
            setStatus("unavailable");
          }
        } catch {
          if (!cancelled) setStatus("unavailable");
        }
      }

      /**
       * Probes for a live data stream the same way regardless of *why*
       * there's nothing to ask permission for — used by both branches of
       * `startWeb` below that reach "there is no button to show".
       */
      async function probeAvailabilityThenStream() {
        // The shim's `isAvailableAsync` waits for a `deviceorientation`
        // event, the very sensor this hook no longer reads. The
        // `WEB_SILENT_TIMEOUT_MS` watchdog in `beginStreamingWeb` is the
        // real availability probe now: subscribe, and demote to
        // "unavailable" only if no `devicemotion` sample ever arrives.
        if (cancelled) return;
        beginStreamingWeb();
      }

      async function startWeb() {
        if (isDesktopBrowser()) {
          setStatus("desktop");
          return;
        }
        // Feature-detect the permission-request API ourselves rather than
        // trusting `expo-sensors`' derived status for this decision alone —
        // its heuristic leans on UA sniffing internally, and the one thing
        // that must never happen is showing a button whose tap goes on to
        // call a function that doesn't safely exist. `false` here covers
        // two very different browsers identically on purpose: a
        // desktop/Android browser that never needed permission at all (the
        // Android-Chrome case), and an iOS Safari old enough (<13) that
        // motion access is an on/off Settings toggle with no in-app re-ask
        // possible — neither has anything for a button to usefully do, so
        // both fall straight through to the same "does data actually
        // arrive" probe instead of ever reaching `permission-required`.
        if (!hasWebMotionPermissionApi()) {
          await probeAvailabilityThenStream();
          return;
        }

        // Unlike native, we check permission *before* availability: on iOS
        // Safari `isAvailableAsync()` itself waits (up to ~250 ms) for a
        // live event to prove availability, which can never happen before
        // permission is granted — checking availability first would always
        // read "unavailable" and the user would never see a way to grant
        // permission at all.
        let permission;
        try {
          permission = await Accelerometer.getPermissionsAsync();
        } catch {
          if (!cancelled) setStatus("permission-denied");
          return;
        }
        if (cancelled) return;

        if (permission.status === "denied") {
          // An explicit prior refusal this session.
          setStatus("permission-denied");
          return;
        }

        if (permission.status !== "granted") {
          // "undetermined", and we've already confirmed above that
          // `DeviceMotionEvent.requestPermission` genuinely exists on this
          // browser and only resolves when called from a user gesture —
          // show the button and wait for a real tap (`requestWebPermission`)
          // instead of asking here. Note `getPermissionsAsync()` reports
          // "undetermined" on this class of browser *unconditionally*, even
          // after a real grant — it can't know without asking — which is
          // why a successful grant is threaded through via `webGrantedRef`
          // instead of ever re-running this check.
          setStatus("permission-required");
          return;
        }

        // Already granted — a previous grant earlier this session. Still
        // confirm data actually shows up before calling it "streaming".
        await probeAvailabilityThenStream();
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

  return { status, samples, requestWebPermission };
}
