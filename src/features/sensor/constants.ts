/**
 * Requested accelerometer update interval (spec-v1.md §4.8 targets a live,
 * responsive trace — we ask for ~50 Hz). `setUpdateInterval` is a request,
 * not a guarantee:
 *  - Since Android 12 (API 31) the platform caps sensor delivery at 200 Hz
 *    per app unless `HIGH_SAMPLING_RATE_SENSORS` is declared — irrelevant
 *    at our 50 Hz ask.
 *  - Below that cap, Android still treats the interval as a *hint* to the
 *    OEM sensor HAL/batching layer, not a hard contract. Cheap Android
 *    chipsets — our baseline device profile (PROJECT.md) — commonly coalesce
 *    or throttle delivery to their own cadence (often ~20-30 Hz in practice)
 *    regardless of the 20 ms interval requested here. iOS's CMMotionManager
 *    honors the requested interval far more reliably.
 *  - We do not try to compensate for this: the windowing logic below is
 *    time-based (last `PLOT_WINDOW_MS`), not sample-count-based, so the
 *    chart simply plots however many samples a given device actually
 *    delivered in the last window — honest and still readable at lower
 *    real-world rates, with no special-casing needed per platform.
 */
export const ACCELEROMETER_UPDATE_INTERVAL_MS = 20; // ~50 Hz requested

/** Scrolling plot window (spec-v1.md §4.8 wave brief: "last ~10 s"). */
export const PLOT_WINDOW_MS = 10_000;

/**
 * Render-state update cadence. The native sensor listener (up to ~50 Hz)
 * only ever writes into a ring-buffer ref — no React state touched there. A
 * separate interval reads the buffer and commits a single state update at
 * this cadence, capping re-renders at ~30 fps regardless of the incoming
 * sample rate ("do NOT setState at 50 Hz").
 */
export const PLOT_RENDER_INTERVAL_MS = 33; // ~30 fps

/**
 * Ring-buffer capacity, generously sized above what 10 s at the ~50 Hz we
 * request would need (500), so the buffer never silently drops a sample
 * that's still inside the visible window even if a device delivers faster
 * than requested.
 */
export const RING_BUFFER_CAPACITY = 1000;

/** Caps polyline points redrawn per axis per render tick — the ring buffer
 * bounds memory, this bounds render/layout cost (design-language.md §8:
 * "throttle the sensor chart's redraw rate ... rather than dropping frames
 * silently"). */
export const MAX_PLOT_POINTS = 150;

/**
 * Web only: how long we let a freshly-subscribed listener stay silent
 * before concluding the browser isn't actually going to deliver motion
 * data — the "listening timeout fallback" for cases `isAvailableAsync()`
 * can't catch on its own (iOS 12.2–12.4's Settings > Safari > Motion &
 * Orientation Access toggle switched off, or a desktop/Android browser
 * that reports "available" unconditionally but has no real hardware —
 * see `expo-sensors`' web shim, which only ever returns `false` from
 * `isAvailableAsync()` for iOS-style permission gates). Generous relative
 * to the ~250 ms `isAvailableAsync()` uses internally, so a slow-to-fire
 * but genuinely working sensor isn't cut off prematurely.
 */
export const WEB_SILENT_TIMEOUT_MS = 1500;

/**
 * Minimum Y-axis half-span in g. A resting phone on a flat surface produces
 * an extremely low-noise trace (a small fraction of a g of jitter on most
 * MEMS accelerometers). Auto-scaling tightly to that tiny range would blow a
 * hairline of sensor noise up into a chart that reads as constant shaking.
 * Flooring the half-span at ±0.05 g keeps a resting phone reading as a calm,
 * readable near-flat line.
 */
export const MIN_Y_HALF_SPAN_G = 0.05;
