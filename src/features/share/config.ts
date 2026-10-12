import { SHORT_EVENT_URL_BASE, SHORT_PROFILE_URL_BASE } from "@/config/urls";

import type { ShareCardSize } from "./types";

/**
 * Tunable constants for event sharing (owner note N14). One module, so the
 * public link shape and the image sizes are each defined once.
 */

/**
 * A shared event link: the short `bumelerze.com/e/<id>` form, which the
 * website forwards to the web app's event route (that route resolves a `bml`
 * id, and a provider id by redirecting to the `bml` one). Short links never
 * change when the app's own address does (src/config/urls.ts). Rich link
 * previews are still deferred.
 */
export const SHARE_EVENT_URL_BASE = SHORT_EVENT_URL_BASE;

/** A shared profile link: `bumelerze.com/u/<username>`, forwarded to the web
 * app's public profile route (`/u/<username>`). */
export const SHARE_PROFILE_URL_BASE = SHORT_PROFILE_URL_BASE;

/** The site name printed in the card footer. A domain, not a translated word. */
export const SHARE_SITE_TEXT = "bumelerze.com";

/** Share images are always this wide; the height depends on the format. */
export const SHARE_IMAGE_WIDTH = 1080;

export const SHARE_IMAGE_HEIGHTS: Readonly<Record<ShareCardSize, number>> = {
  square: 1080,
  story: 1920,
};

/** Characters that make a LTR run safe inside a RTL sentence (Unicode isolates). */
export const LEFT_TO_RIGHT_ISOLATE = "⁦";
export const RIGHT_TO_LEFT_ISOLATE = "⁧";
export const POP_DIRECTIONAL_ISOLATE = "⁩";
