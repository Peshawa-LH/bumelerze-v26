import { SHORT_EVENT_URL_BASE, SHORT_PROFILE_URL_BASE } from "@/config/urls";

import type { ShareCardSize } from "./types";

/**
 * Tunable constants for event sharing (owner note N14). One module, so the
 * public link shape and the image sizes are each defined once.
 */

/**
 * A shared event link: the short `app.bumelerze.com/e/<id>` form, which the
 * app's own `e/[id]` route sends straight on to `/event/<id>` (that route
 * resolves a `bml` id, and a provider id by redirecting to the `bml` one).
 * On the app host since 2026-10-14 (D-1): the page carries the app's Open
 * Graph tags, so messengers unfurl a shared link (src/config/urls.ts).
 */
export const SHARE_EVENT_URL_BASE = SHORT_EVENT_URL_BASE;

/** A shared profile link: `app.bumelerze.com/u/<username>`, the web app's
 * public profile route itself. */
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
