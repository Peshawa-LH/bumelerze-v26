/**
 * The web (and any non-native platform) twin of `native-decoders.native.ts`.
 * The web decodes and streams with seisplotjs (`trace-transport.ts`,
 * `datalink.ts`) and never calls these; keeping them empty keeps the native
 * decoder and client out of the web bundle.
 */
import type { openDataLinkStream as OpenDataLinkStream } from "./datalink-native";
import type { DecodedSegment } from "./miniseed";

export function decodeMiniSeedNative(_buffer: ArrayBuffer): DecodedSegment[] {
  return [];
}

export const openDataLinkStream: typeof OpenDataLinkStream = (
  _url,
  _pattern,
  _onSegment,
  onError,
) => {
  onError(new Error("The native DataLink client runs on iOS and Android only"));
  return () => undefined;
};
