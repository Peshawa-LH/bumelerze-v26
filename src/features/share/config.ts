import type { ShareCardSize } from "./types";

/**
 * Tunable constants for event sharing (owner note N14). One module, so the
 * public link shape and the image sizes are each defined once.
 */

/**
 * Where a shared event link lands: the web app's event route, which already
 * resolves a `bml` id (and a provider id, redirecting to the `bml` one). The
 * short `bumelerze.com/e/<id>` form and rich link previews are deferred until
 * the edge-function infrastructure exists, so this is the one place to change
 * when they arrive.
 */
export const SHARE_EVENT_URL_BASE = "https://bumelerze.com/app/event";

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
