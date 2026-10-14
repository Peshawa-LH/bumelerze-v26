import { ATLAS_INDEX } from "./atlas";
import type { AtlasBundleEntry } from "./types";

/**
 * Where `useShakeMap` gets a bundled Atlas product from. iOS/Android: the
 * products are part of the app bundle, so the answer is immediate. The web
 * build has its own version (`atlas-source.web.ts`) that downloads one
 * event's product only when that event is opened, so the first page load
 * does not carry all eleven maps.
 *
 * `peekAtlasEntry` answers synchronously: the entry, `null` when the event
 * has no bundled product, or `undefined` while it is not loaded yet (web
 * only).
 */
export function peekAtlasEntry(eventId: string): AtlasBundleEntry | null | undefined {
  return ATLAS_INDEX[eventId] ?? null;
}

export function loadAtlasEntry(eventId: string): Promise<AtlasBundleEntry | null> {
  return Promise.resolve(ATLAS_INDEX[eventId] ?? null);
}
