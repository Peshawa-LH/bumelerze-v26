import {
  AFEAD_HIT_LAYER_ID,
  FAULTS_HIT_LAYER_ID,
  HISTORICAL_LAYER_ID,
} from "../layer-registry";
import {
  describeOverlayFeature,
  parseGemSlipRate,
  parseGemSlipType,
} from "../overlay-info";

describe("overlay info", () => {
  it("reads an AFEAD fault: name, zone, sense, rate class, confidence, references", () => {
    expect(
      describeOverlayFeature(AFEAD_HIT_LAYER_ID, {
        n: "Chalderan",
        z: "Chalderan",
        s1: "D",
        s2: "R",
        c: "A",
        r: "1",
        a: "Trifonov et al., 1994",
      }),
    ).toEqual({
      kind: "fault",
      source: "afead",
      name: "Chalderan",
      zone: "Chalderan",
      primary: "dextral",
      secondary: "reverse",
      slipRate: null,
      rateRank: "1",
      confidence: "A",
      references: "Trifonov et al., 1994",
      catalog: null,
    });
  });

  it("tolerates a bare AFEAD feature", () => {
    const info = describeOverlayFeature(AFEAD_HIT_LAYER_ID, {});
    expect(info).toMatchObject({
      kind: "fault",
      name: null,
      primary: "unknown",
      confidence: null,
    });
  });

  it("reads a GEM fault's oblique slip type and its (preferred,min,max) rate", () => {
    expect(parseGemSlipType("Dextral-Reverse")).toEqual({
      primary: "dextral",
      secondary: "reverse",
    });
    expect(parseGemSlipType(undefined)).toEqual({ primary: "unknown", secondary: null });
    expect(parseGemSlipRate("(1.5,1.0,2.0)")).toEqual({ preferred: 1.5, min: 1, max: 2 });
    expect(parseGemSlipRate("(0.3,,)")).toEqual({ preferred: 0.3, min: null, max: null });
    expect(parseGemSlipRate(null)).toBeNull();
    expect(
      describeOverlayFeature(FAULTS_HIT_LAYER_ID, {
        slip_type: "Reverse",
        net_slip_rate: "(1.0,0.5,1.5)",
        catalog_name: "EMME",
      }),
    ).toMatchObject({
      source: "gem",
      primary: "reverse",
      catalog: "EMME",
      slipRate: { preferred: 1 },
    });
  });

  it("reads a past earthquake and refuses one without magnitude", () => {
    expect(
      describeOverlayFeature(HISTORICAL_LAYER_ID, {
        id: "bml08720001",
        t: null,
        year: 872,
        m: 6.8,
        mt: "Mw",
        d: null,
        src: "EMME",
        era: "historical",
      }),
    ).toEqual({
      kind: "quake",
      id: "bml08720001",
      year: 872,
      timeMs: null,
      magnitude: 6.8,
      magType: "Mw",
      depthKm: null,
      source: "EMME",
      era: "historical",
    });
    expect(describeOverlayFeature(HISTORICAL_LAYER_ID, { year: 2000 })).toBeNull();
    expect(describeOverlayFeature("some-other-layer", { m: 5 })).toBeNull();
  });
});
