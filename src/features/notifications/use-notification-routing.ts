/**
 * iOS/Android: opens the right screen when the person taps an earthquake
 * alert notification (the web's service worker does this on the web,
 * public/push-sw.js).
 *
 * Placeholder, mounted from app/_layout.tsx: it does nothing yet. The
 * native push work fills it in: the tapped notification's `data.path`
 * (`event/<id>`, `notification-settings`; supabase/functions/send-alerts)
 * opened with the router, for a tap that started the app as well as one
 * while it runs, and only once `ready`.
 */
export interface NotificationRoutingOptions {
  /** True once a screen can be opened: settings read, onboarding done and
   * no restart under way. A tap that arrives earlier waits for it. */
  ready: boolean;
}

export function useNotificationRouting(_options: NotificationRoutingOptions): void {}
