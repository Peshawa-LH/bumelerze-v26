import { resolveIncomingLink } from "@/features/links/incoming";
import { noteIncomingLink } from "@/features/links/pending-link";

/**
 * iOS/Android: every address that opens the app passes through here first
 * (Expo Router's native link hook; the web reads its own address bar).
 *
 * - `https://app.bumelerze.com/…` (universal links), `bumelerze://…` and the
 *   website's old short links become the app path the web would show:
 *   `/e/<id>` goes straight to `/event/<id>`, `/u/<username>` and
 *   `/home/join?code=…&key=…` stay as they are (src/features/links/incoming.ts).
 * - The link is noted, so one that arrives before onboarding is finished
 *   opens right after it (src/features/links/pending-link.ts).
 * - Static files, the Google / Apple sign-in return (`bumelerze://auth/callback`,
 *   read by the sign-in session itself) and website pages open nothing: a
 *   link that starts the app lands on Home, one that arrives later leaves the
 *   app where it is.
 * - The development build's own links pass through untouched.
 *
 * Must never throw (a throw here can crash the app on launch).
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | null {
  try {
    const link = resolveIncomingLink(path);
    if (link.kind === "passthrough") {
      return path;
    }
    if (link.kind === "ignore") {
      return initial ? "/" : null;
    }
    noteIncomingLink(link.path);
    return link.path;
  } catch {
    return initial ? "/" : null;
  }
}
