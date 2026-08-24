import type { ImageSource } from "expo-image";

/**
 * Owner-commissioned Safety-section artwork, wired in from
 * `assets/artwork/` exactly like `src/features/felt/artwork.ts`
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
  dropCoverHold: require("../../../assets/artwork/safety/safety-drop-cover-hold.webp"),
  coverHeadNeck: require("../../../assets/artwork/safety/safety-cover-head-neck.webp"),
  wheelchair: require("../../../assets/artwork/safety/safety-wheelchair.webp"),
  caneOrWalker: require("../../../assets/artwork/safety/safety-cane-walker.webp"),
  inBed: require("../../../assets/artwork/safety/safety-in-bed.webp"),
  dontDoorway: require("../../../assets/artwork/safety/safety-dont-doorway.webp"),
  dontRunOutside: require("../../../assets/artwork/safety/safety-dont-run-outside.webp"),
  outdoorsOpenGround: require("../../../assets/artwork/safety/safety-outdoors-open-ground.webp"),
  vehiclePullOver: require("../../../assets/artwork/safety/safety-vehicle-pull-over.webp"),
  dontOverpass: require("../../../assets/artwork/safety/safety-dont-overpass.webp"),
  useStairs: require("../../../assets/artwork/safety/safety-use-stairs.webp"),
  dontElevator: require("../../../assets/artwork/safety/safety-dont-elevator.webp"),
  gasLeakResponse: require("../../../assets/artwork/safety/safety-gas-leak-response.webp"),
  dontSpark: require("../../../assets/artwork/safety/safety-dont-spark.webp"),
  secureFurniture: require("../../../assets/artwork/safety/safety-secure-furniture.webp"),
  secureWaterTank: require("../../../assets/artwork/safety/safety-secure-water-tank.webp"),
  secureGasCylinder: require("../../../assets/artwork/safety/safety-secure-gas-cylinder.webp"),
  safeSpotRoom: require("../../../assets/artwork/safety/safety-safe-spot-room.webp"),
};
