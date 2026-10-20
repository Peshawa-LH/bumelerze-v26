/**
 * iOS/Android: the miniSEED decoder and DataLink client that stand in for
 * seisplotjs, which cannot load on Hermes (`miniseed.ts`). The web resolves
 * `native-decoders.ts`, so neither reaches the web bundle.
 */
export { decodeMiniSeed as decodeMiniSeedNative } from "./miniseed";
export { openDataLinkStream } from "./datalink-native";
