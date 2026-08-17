/**
 * Golden-fixture sync check between this lib and its vendored copy under
 * `supabase/functions/aggregate-felt-cells/felt-aggregation/` (the
 * `aggregate-felt-cells` Edge Function's own module — Deno can't import
 * `@/features/felt/types`-aliased RN source directly, so that folder is a
 * hand-synced verbatim copy; see its own `answer-types.ts` doc comment for
 * the full rationale).
 *
 * This test feeds the SAME inputs — deliberately overlapping the golden
 * fixtures in `cell-aggregation.test.ts`, `cdi-scoring.test.ts`, and
 * `geohash.test.ts` — through BOTH copies of every exported pure function
 * and asserts byte-identical output. If a future edit updates one copy's
 * math (a scoring table tweak, a formula constant, a rounding rule) without
 * updating the other, this is the test that catches the drift; nothing
 * about the Edge Function's own deployment proves it on its own since Deno
 * isn't run as part of this repo's test suite.
 */

import {
  aggregateCell as originalAggregateCell,
  encodeGeohash as originalEncodeGeohash,
  scoreTier2Report as originalScoreTier2Report,
} from "../index";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- cross-package path outside `src/`, and the two copies' `Tier2Answers`/`AggregationInputReport` types are structurally (not nominally) identical, so plain `require` + loosely-typed fixtures below avoid fighting TS over two distinct-but-identical type declarations for no behavioral benefit.
const vendored = require("../../../../supabase/functions/aggregate-felt-cells/felt-aggregation/index") as {
  aggregateCell: typeof originalAggregateCell;
  encodeGeohash: typeof originalEncodeGeohash;
  scoreTier2Report: typeof originalScoreTier2Report;
};

const EMPTY_ANSWERS = {
  situation: null,
  felt: null,
  othersFelt: null,
  motion: null,
  reaction: null,
  stand: null,
  shelf: null,
  picture: null,
  furniture: null,
  buildingDamageLevel: null,
  damageTypology: null,
  roadDamageLevel: null,
  comment: null,
};

function tier1(deviceId: string, cartoonLevel: number) {
  return { tier: "tier1" as const, deviceId, cartoonLevel };
}
function tier2(deviceId: string, overrides: Record<string, unknown>) {
  return { tier: "tier2" as const, deviceId, answers: { ...EMPTY_ANSWERS, ...overrides } };
}

describe("encodeGeohash: vendored copy matches the source lib", () => {
  const cases: [number, number, number][] = [
    [57.64911, 10.40744, 6],
    [35.56, 45.43, 5], // roughly Sulaymaniyah — the app's own region
    [0, 0, 4],
    [-33.87, 151.21, 7], // negative lat, sanity
    [90, 180, 8], // boundary values
  ];
  it.each(cases)("lat=%p lon=%p precision=%p", (lat, lon, precision) => {
    expect(vendored.encodeGeohash(lat, lon, precision)).toBe(
      originalEncodeGeohash(lat, lon, precision),
    );
  });
});

describe("scoreTier2Report: vendored copy matches the source lib", () => {
  const overridesList: Record<string, unknown>[] = [
    {},
    { felt: "yes", othersFelt: "most" },
    { felt: "no", othersFelt: "some" },
    { motion: "violent", situation: "moving_car" }, // R17 vehicle exclusion
    { stand: "fell", situation: "moving_car" },
    { shelf: "many_fell", picture: "yes", furniture: "yes" },
    { buildingDamageLevel: 5 },
    { buildingDamageLevel: 1 },
  ];
  const fixtures = overridesList.map((overrides) => ({ ...EMPTY_ANSWERS, ...overrides }));
  it.each(fixtures)("answers %#", (answers) => {
    expect(vendored.scoreTier2Report(answers as never)).toEqual(
      originalScoreTier2Report(answers as never),
    );
  });
});

describe("aggregateCell: vendored copy matches the source lib", () => {
  const fixtures: { name: string; reports: unknown[] }[] = [
    { name: "empty", reports: [] },
    { name: "single not-felt tier2", reports: [tier2("d1", { felt: "no" })] },
    { name: "single not-felt tier1", reports: [tier1("d1", 1)] },
    {
      name: "max CWS single report",
      reports: [
        tier2("d1", {
          felt: "yes",
          othersFelt: "everyone",
          motion: "violent",
          reaction: "extremely_frightened",
          stand: "fell",
          shelf: "many_fell",
          picture: "yes",
          furniture: "yes",
          buildingDamageLevel: 5,
        }),
      ],
    },
    {
      name: "dedup: tier2 supersedes tier1 for the same device",
      reports: [tier1("same-device", 9), tier2("same-device", { felt: "no" })],
    },
    {
      name: "mixed tier1 + tier2 combination",
      reports: [
        tier2("t2-a", {
          felt: "yes",
          motion: "strong",
          reaction: "very_frightened",
          stand: "difficult",
          shelf: "many_fell",
          picture: "yes",
          furniture: "yes",
          buildingDamageLevel: 4,
        }),
        tier2("t2-b", {
          felt: "yes",
          motion: "strong",
          reaction: "very_frightened",
          stand: "difficult",
          shelf: "many_fell",
          picture: "yes",
          furniture: "yes",
          buildingDamageLevel: 4,
        }),
        tier1("t1-a", 4),
        tier1("t1-b", 5),
        tier1("t1-c", 6),
      ],
    },
    {
      name: "n>=5 tier1-only trims min/max",
      reports: [tier1("a", 9), tier1("b", 1), tier1("c", 5), tier1("d", 2), tier1("e", 3)],
    },
    {
      name: "below display threshold (2 reports)",
      reports: [tier1("a", 4), tier1("b", 4)],
    },
  ];

  it.each(fixtures)("$name", ({ reports }) => {
    expect(vendored.aggregateCell(reports as never)).toEqual(
      originalAggregateCell(reports as never),
    );
  });
});
