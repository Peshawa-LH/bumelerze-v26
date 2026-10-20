/**
 * The web: no expo-notifications at all (see notifications-module.native.ts).
 * The browser's own Notification API answers the permission questions
 * (permissions.ts), and alerts are web push (features/alerts).
 */
export type NotificationsModule = typeof import("expo-notifications");

export function requireNotifications(): NotificationsModule | null {
  return null;
}
