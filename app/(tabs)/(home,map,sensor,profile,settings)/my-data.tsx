import { Redirect } from "expo-router";

/**
 * `/my-data` was "My account" until D79 (2026-10-08). The page is now the
 * Profile tab; this route stays only so old links keep working (the tour, a
 * notification, a shared deep link, an older build's saved route). It renders
 * nothing of its own and replaces itself with the tab.
 */
export default function MyDataRedirect() {
  return <Redirect href="/profile" />;
}
