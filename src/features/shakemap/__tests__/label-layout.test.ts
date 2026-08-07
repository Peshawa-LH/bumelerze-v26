import {
  EPICENTER_LABEL_EXCLUSION_RADIUS_PX,
  layoutCityLabels,
  type LabelCandidate,
} from "../label-layout";

const MAP_CENTER = { x: 160, y: 120 };
const EPICENTER = { x: 160, y: 120 };

describe("layoutCityLabels", () => {
  it("drops any city whose own dot sits inside the epicenter's exclusion radius", () => {
    const candidates: LabelCandidate[] = [
      {
        id: "on-epicenter",
        // Well inside EPICENTER_LABEL_EXCLUSION_RADIUS_PX of EPICENTER.
        dot: { x: EPICENTER.x + 2, y: EPICENTER.y + 2 },
        text: "Right On Top",
      },
      {
        id: "far-away",
        dot: { x: EPICENTER.x + 100, y: EPICENTER.y },
        text: "Far City",
      },
    ];

    const result = layoutCityLabels(candidates, EPICENTER, MAP_CENTER);

    expect(result.map((label) => label.id)).toEqual(["far-away"]);
  });

  it("keeps the epicenter zone clear even for a label offset toward it", () => {
    // Dot sits just outside the exclusion radius, but close enough that a
    // naive offset toward the epicenter would paint the label over it —
    // `resolveSide` pushes it further away instead, and the collision
    // check against the epicenter box is the second line of defense.
    const candidates: LabelCandidate[] = [
      {
        id: "near-epicenter",
        dot: { x: EPICENTER.x + EPICENTER_LABEL_EXCLUSION_RADIUS_PX + 1, y: EPICENTER.y },
        text: "Near",
      },
    ];

    const result = layoutCityLabels(candidates, EPICENTER, MAP_CENTER);

    expect(result).toHaveLength(1);
    const [label] = result;
    expect(label).toBeDefined();
    // The label's anchor (and therefore its whole estimated box, which
    // only extends further in the same direction) must not fall back
    // inside the epicenter's own exclusion radius.
    const anchorDistanceFromEpicenter = Math.hypot(
      label!.anchor.x - EPICENTER.x,
      label!.anchor.y - EPICENTER.y,
    );
    expect(anchorDistanceFromEpicenter).toBeGreaterThanOrEqual(
      EPICENTER_LABEL_EXCLUSION_RADIUS_PX,
    );
  });

  it("when two cities' dots are close enough that both labels would collide, keeps the higher-priority one and skips the other", () => {
    // Two dots 10px apart, both to the right of center (same offset side),
    // close enough that "City One"/"City Two" labels at that font-size
    // estimate would overlap.
    const candidates: LabelCandidate[] = [
      { id: "priority-city", dot: { x: 250, y: 120 }, text: "Priority City" },
      { id: "second-city", dot: { x: 260, y: 120 }, text: "Second City" },
    ];

    const result = layoutCityLabels(candidates, EPICENTER, MAP_CENTER);

    // Greedy pass keeps the first (higher-priority) candidate; the second
    // is dropped because its estimated box collides with the first's.
    expect(result.map((label) => label.id)).toEqual(["priority-city"]);
  });

  it("places both labels once they're far enough apart not to collide", () => {
    const candidates: LabelCandidate[] = [
      { id: "left-city", dot: { x: 40, y: 60 }, text: "Alpha" },
      { id: "right-city", dot: { x: 280, y: 180 }, text: "Beta" },
    ];

    const result = layoutCityLabels(candidates, EPICENTER, MAP_CENTER);

    expect(result.map((label) => label.id).sort()).toEqual(["left-city", "right-city"]);
  });

  it("offsets each label to the side of its dot away from the map center", () => {
    const candidates: LabelCandidate[] = [
      { id: "west-city", dot: { x: 20, y: 120 }, text: "West" },
      { id: "east-city", dot: { x: 300, y: 120 }, text: "East" },
    ];

    const result = layoutCityLabels(candidates, EPICENTER, MAP_CENTER);
    const byId = new Map(result.map((label) => [label.id, label]));

    // West of center (dot.x < mapCenter.x) -> anchored to grow further
    // left ("end" text-anchor), away from the center.
    const west = byId.get("west-city");
    expect(west).toBeDefined();
    expect(west!.textAnchor).toBe("end");
    expect(west!.anchor.x).toBeLessThan(west!.dot.x);

    // East of center -> grows further right, also away from the center.
    const east = byId.get("east-city");
    expect(east).toBeDefined();
    expect(east!.textAnchor).toBe("start");
    expect(east!.anchor.x).toBeGreaterThan(east!.dot.x);
  });

  it("always preserves the dot position even when the label itself is skipped", () => {
    const candidates: LabelCandidate[] = [
      {
        id: "on-epicenter",
        dot: { x: EPICENTER.x + 1, y: EPICENTER.y },
        text: "Skipped",
      },
    ];

    // The dot itself isn't returned by this function at all (ShakeMapView
    // always draws every picked city's dot regardless of label outcome) —
    // this test documents that the function only ever decides label fate,
    // never drops the underlying candidate's positional data silently.
    const result = layoutCityLabels(candidates, EPICENTER, MAP_CENTER);
    expect(result).toHaveLength(0);
  });

  it("never returns more labels than candidates given", () => {
    const candidates: LabelCandidate[] = Array.from({ length: 8 }, (_, index) => ({
      id: `city-${index}`,
      dot: { x: 20 + index * 5, y: 20 },
      text: `City ${index}`,
    }));

    const result = layoutCityLabels(candidates, EPICENTER, MAP_CENTER);
    expect(result.length).toBeLessThanOrEqual(candidates.length);
  });
});
