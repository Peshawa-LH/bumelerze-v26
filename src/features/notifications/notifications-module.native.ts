/**
 * iOS/Android: expo-notifications, required on first use.
 *
 * This `.native.ts` file is the ONLY place that loads the package. The web
 * build resolves `notifications-module.ts` instead, which returns null, so
 * expo-notifications never reaches the web bundle: merely importing it
 * starts its push-token listener, which on the web only printed a warning
 * on every visit (review B-22); web alerts are web push (features/alerts).
 *
 * A plain `require` (not `import()`): Metro serves a dynamic import from a
 * separate bundle in development builds, so the foreground handler would be
 * set a moment after launch (and a development build whose node_modules
 * lives outside the project could not load it at all). Required, it is
 * there as soon as app/_layout.tsx loads.
 */
export type NotificationsModule = typeof import("expo-notifications");

export function requireNotifications(): NotificationsModule | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded on first use, see above
  return require("expo-notifications") as NotificationsModule;
}
