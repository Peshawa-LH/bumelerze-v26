import { useAccount } from "@/features/account/use-account";
import { keptRouteId, type HiddenEarthquake } from "@/features/home-extras";
import { useMyPermissions } from "./queries";
import type { EventHubTransport } from "./transport";

/**
 * What a page reached by an earthquake's id does when Bumelerze hid that
 * earthquake for everyone (migration 0085, owner choice 4):
 *  - `show`: not hidden; or hidden and the reader is an admin with
 *    `events.hide` (`adminView`: the page shows the banner 2.23, no
 *    redirect, so admins can look at what they hid);
 *  - `wait`: hidden, and whether the reader is such an admin is not known
 *    yet (the account or its permissions are still loading);
 *  - `redirect`: a second card; the page replaces itself with the card that
 *    stays (`keptRouteId`), so old links keep working (wording 2.21);
 *  - `removed`: "Earthquake removed" (wording 2.22).
 * `events.hide` reaches the app only in a two-step session (migration
 * 0076), so an admin signed in without the code sees what everyone sees.
 */
export type HiddenRouteMode = "show" | "wait" | "redirect" | "removed";

export interface HiddenRouteGate {
  mode: HiddenRouteMode;
  /** The id to replace the route with, for `redirect`. */
  keptRouteId: string | null;
  /** An admin looking at a hidden earthquake: show banner 2.23. */
  adminView: boolean;
}

const SHOW: HiddenRouteGate = { mode: "show", keptRouteId: null, adminView: false };

export function useHiddenRouteGate(
  hidden: HiddenEarthquake | null,
  hubTransport?: EventHubTransport,
): HiddenRouteGate {
  const account = useAccount();
  const userId = account.status === "account" ? account.userId : null;
  const perms = useMyPermissions(userId, hubTransport);
  if (!hidden) {
    return SHOW;
  }
  if (!perms.legacy && perms.has("events.hide")) {
    return { mode: "show", keptRouteId: null, adminView: true };
  }
  if (account.status === "loading" || perms.isLoading) {
    return { mode: "wait", keptRouteId: null, adminView: false };
  }
  const kept = keptRouteId(hidden);
  return kept
    ? { mode: "redirect", keptRouteId: kept, adminView: false }
    : { mode: "removed", keptRouteId: null, adminView: false };
}
