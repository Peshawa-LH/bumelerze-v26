import type { ImageSource } from "expo-image";

/**
 * Owner-commissioned Safety-section artwork, wired in from
 * `assets/Bumelerze-App-Visual-Assets/` exactly like `src/features/felt/artwork.ts`
 * (see that file's doc comment for the full rationale — same package, same
 * checksummed handoff, same reasons). Mirrors its two conventions:
 *
 * - **Format:** WebP-512 (not PNG-512) for the same ~30% bundle-size saving
 *   with no quality tradeoff (`expo-image` decodes WebP natively on both
 *   platforms) — the 18 files here add ~3.3 MB to the bundle, in the same
 *   frugal ballpark as the felt package's 22 tiles.
 * - **Literal paths only:** every `require()` argument below is a full
 *   literal string, never built from a shared constant — Metro's static
 *   dependency collector only recognizes that exact shape, and an
 *   interpolated path fails silently at runtime. That's why this map is
 *   written out by hand rather than generated from `SafetyImageId` in a loop.
 *
 * `SafetyImageId` is also exported from here (rather than `content.ts`)
 * because the id set and the require map are one artifact: adding an id
 * without a matching `require()` is a compile error, not a runtime one.
 */
export type SafetyImageId =
  | "dropCoverHold"
  | "coverHeadNeck"
  | "wheelchair"
  | "caneOrWalker"
  | "inBed"
  | "dontDoorway"
  | "dontRunOutside"
  | "outdoorsOpenGround"
  | "vehiclePullOver"
  | "dontOverpass"
  | "useStairs"
  | "dontElevator"
  | "gasLeakResponse"
  | "dontSpark"
  | "secureFurniture"
  | "secureWaterTank"
  | "secureGasCylinder"
  | "safeSpotRoom";

export const SAFETY_ARTWORK: Record<SafetyImageId, ImageSource> = {
  dropCoverHold: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-drop-cover-hold.webp"),
  coverHeadNeck: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-cover-head-neck.webp"),
  wheelchair: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-wheelchair.webp"),
  caneOrWalker: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-cane-walker.webp"),
  inBed: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-in-bed.webp"),
  dontDoorway: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-dont-doorway.webp"),
  dontRunOutside: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-dont-run-outside.webp"),
  outdoorsOpenGround: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-outdoors-open-ground.webp"),
  vehiclePullOver: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-vehicle-pull-over.webp"),
  dontOverpass: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-dont-overpass.webp"),
  useStairs: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-use-stairs.webp"),
  dontElevator: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-dont-elevator.webp"),
  gasLeakResponse: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-gas-leak-response.webp"),
  dontSpark: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-dont-spark.webp"),
  secureFurniture: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-secure-furniture.webp"),
  secureWaterTank: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-secure-water-tank.webp"),
  secureGasCylinder: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-secure-gas-cylinder.webp"),
  safeSpotRoom: require("../../../assets/Bumelerze-App-Visual-Assets/05-App-Ready/Visuals/WebP-512/safety-safe-spot-room.webp"),
};
