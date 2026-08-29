/**
 * Regression-locks `artwork.ts`'s static require() map against the
 * commissioned artwork package (owner Safety-artwork wave, 2026-08-17,
 * extended by the 6-image supplementary wave, 2026-08-29) — mirrors
 * `felt/__tests__/artwork.test.ts` exactly, including the reason each of the
 * 24 package files gets its own individually-mocked `jest.mock(...)` call
 * with a unique marker string: `jest-expo`'s asset transform collapses every
 * image `require()` to the same value, so comparing resolved values directly
 * can't tell one file from another. This proves both that every
 * `SafetyImageId` resolves (no missing/mis-typed file crashes the require)
 * and that each id points at the RIGHT file — the same off-by-one class of
 * bug the felt artwork map was once bitten by.
 *
 * Every call below must use a literal module-path string and a factory with
 * no outer-variable references (babel-plugin-jest-hoist forbids closures in
 * `jest.mock` factories) — that's why this isn't a loop.
 */

// prettier-ignore
jest.mock("../../../../assets/artwork/safety/safety-drop-cover-hold.webp", () => "asset:safety-drop-cover-hold.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-cover-head-neck.webp", () => "asset:safety-cover-head-neck.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-wheelchair.webp", () => "asset:safety-wheelchair.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-cane-walker.webp", () => "asset:safety-cane-walker.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-in-bed.webp", () => "asset:safety-in-bed.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-dont-doorway.webp", () => "asset:safety-dont-doorway.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-dont-run-outside.webp", () => "asset:safety-dont-run-outside.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-outdoors-open-ground.webp", () => "asset:safety-outdoors-open-ground.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-vehicle-pull-over.webp", () => "asset:safety-vehicle-pull-over.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-dont-overpass.webp", () => "asset:safety-dont-overpass.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-use-stairs.webp", () => "asset:safety-use-stairs.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-dont-elevator.webp", () => "asset:safety-dont-elevator.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-gas-leak-response.webp", () => "asset:safety-gas-leak-response.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-dont-spark.webp", () => "asset:safety-dont-spark.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-secure-furniture.webp", () => "asset:safety-secure-furniture.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-secure-water-tank.webp", () => "asset:safety-secure-water-tank.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-secure-gas-cylinder.webp", () => "asset:safety-secure-gas-cylinder.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-safe-spot-room.webp", () => "asset:safety-safe-spot-room.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-family-plan.webp", () => "asset:safety-family-plan.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-emergency-kit.webp", () => "asset:safety-emergency-kit.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-school-work-plan.webp", () => "asset:safety-school-work-plan.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-aftershocks.webp", () => "asset:safety-aftershocks.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-reliable-information.webp", () => "asset:safety-reliable-information.webp", { virtual: true });
jest.mock("../../../../assets/artwork/safety/safety-help-neighbors.webp", () => "asset:safety-help-neighbors.webp", { virtual: true });

// Imported after the jest.mock calls above so the mocked module graph is in
// place before this loads.
// eslint-disable-next-line import/first -- see comment above
import { SAFETY_ARTWORK, type SafetyImageId } from "../artwork";

describe("SAFETY_ARTWORK", () => {
  it("has exactly the 24 commissioned image ids, each resolving to its own named file", () => {
    expect(Object.keys(SAFETY_ARTWORK)).toHaveLength(24);

    const expected: Record<SafetyImageId, string> = {
      dropCoverHold: "asset:safety-drop-cover-hold.webp",
      coverHeadNeck: "asset:safety-cover-head-neck.webp",
      wheelchair: "asset:safety-wheelchair.webp",
      caneOrWalker: "asset:safety-cane-walker.webp",
      inBed: "asset:safety-in-bed.webp",
      dontDoorway: "asset:safety-dont-doorway.webp",
      dontRunOutside: "asset:safety-dont-run-outside.webp",
      outdoorsOpenGround: "asset:safety-outdoors-open-ground.webp",
      vehiclePullOver: "asset:safety-vehicle-pull-over.webp",
      dontOverpass: "asset:safety-dont-overpass.webp",
      useStairs: "asset:safety-use-stairs.webp",
      dontElevator: "asset:safety-dont-elevator.webp",
      gasLeakResponse: "asset:safety-gas-leak-response.webp",
      dontSpark: "asset:safety-dont-spark.webp",
      secureFurniture: "asset:safety-secure-furniture.webp",
      secureWaterTank: "asset:safety-secure-water-tank.webp",
      secureGasCylinder: "asset:safety-secure-gas-cylinder.webp",
      safeSpotRoom: "asset:safety-safe-spot-room.webp",
      familyPlan: "asset:safety-family-plan.webp",
      emergencyKit: "asset:safety-emergency-kit.webp",
      schoolWorkPlan: "asset:safety-school-work-plan.webp",
      aftershocks: "asset:safety-aftershocks.webp",
      reliableInformation: "asset:safety-reliable-information.webp",
      helpNeighbors: "asset:safety-help-neighbors.webp",
    };

    for (const [id, expectedFile] of Object.entries(expected)) {
      expect(SAFETY_ARTWORK[id as SafetyImageId]).toBe(expectedFile);
    }
  });
});
