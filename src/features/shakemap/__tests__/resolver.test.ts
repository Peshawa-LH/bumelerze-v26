import { resolveShakeMapProduct, type ShakeMapCandidate } from "../resolver";
import type { AtlasBundleEntry, IntensityContourSet } from "../types";
import type { LiveShakeMapProduct } from "../live-types";

const CONTOURS: IntensityContourSet = { levels: [], skippedCount: 0 };

function liveCandidate(
  overrides: Partial<LiveShakeMapProduct> = {},
): ShakeMapCandidate<LiveShakeMapProduct> {
  return {
    product: {
      eventId: "us2000bmcg",
      producer: "bumelerze",
      version: 3,
      reviewStatus: "automatic",
      dataUsedSummaryKey: "stationConditioned",
      generatedAt: "2026-08-18T00:00:00.000Z",
      contours: {},
      engineVersion: {
        serviceVersion: "0.2.0",
        gsimBranches: "CY14,ASB14",
        emsModel: "Zaniniandhofer19",
        mmiModel: "WordenEtAl12",
        conditioning: "mvn (Engler et al. 2022)",
      },
      ...overrides,
    },
    contours: CONTOURS,
  };
}

function bundledCandidate(
  overrides: Partial<AtlasBundleEntry> = {},
): ShakeMapCandidate<AtlasBundleEntry> {
  return {
    product: {
      eventId: "us2000bmcg",
      producer: "bumelerze",
      version: 1,
      reviewStatus: "reviewed",
      dataUsedSummaryKey: "dyfiConditioned",
      generatedAt: "2026-08-07T00:00:00.000Z",
      contours: {},
      ...overrides,
    },
    contours: CONTOURS,
  };
}

describe("resolveShakeMapProduct", () => {
  it("prefers the live product when both a live and a bundled candidate exist", () => {
    const resolved = resolveShakeMapProduct(liveCandidate(), bundledCandidate());

    expect(resolved).not.toBeNull();
    expect(resolved?.product.source).toBe("live");
    expect(resolved?.product.version).toBe(3);
    expect(resolved?.product.engineVersion?.serviceVersion).toBe("0.2.0");
  });

  it("falls back to the bundled product when no live candidate exists", () => {
    const resolved = resolveShakeMapProduct(null, bundledCandidate());

    expect(resolved).not.toBeNull();
    expect(resolved?.product.source).toBe("bundled");
    expect(resolved?.product.version).toBe(1);
    // The build-time bundle carries no engine-version block — never
    // fabricated, always null for a bundled-source result.
    expect(resolved?.product.engineVersion).toBeNull();
  });

  it("returns null when neither a live nor a bundled candidate exists", () => {
    expect(resolveShakeMapProduct(null, null)).toBeNull();
  });

  it("uses the live candidate's own contours, not the bundled one's, when live wins", () => {
    const liveContours: IntensityContourSet = { levels: [{ value: 6, level: 6, rings: [] }], skippedCount: 0 };
    const resolved = resolveShakeMapProduct(
      { ...liveCandidate(), contours: liveContours },
      bundledCandidate(),
    );

    expect(resolved?.contours).toBe(liveContours);
  });

  it("carries the live product's own review status through untouched (reviewed or provisional)", () => {
    const reviewed = resolveShakeMapProduct(
      liveCandidate({ reviewStatus: "reviewed" }),
      null,
    );
    expect(reviewed?.product.reviewStatus).toBe("reviewed");

    const provisional = resolveShakeMapProduct(
      liveCandidate({ reviewStatus: "automatic" }),
      null,
    );
    expect(provisional?.product.reviewStatus).toBe("automatic");
  });
});
