/**
 * iOS/Android: how a notification that arrives while the app is open is
 * shown (iOS shows nothing for it unless the app says so).
 *
 * Placeholder, called once when app/_layout.tsx loads, before anything
 * renders: it does nothing yet. The native push work fills it in (banner,
 * notification list and sound for earthquake alerts and the local test
 * alert), without loading expo-notifications on the web.
 */
export function installForegroundNotificationHandler(): void {}
