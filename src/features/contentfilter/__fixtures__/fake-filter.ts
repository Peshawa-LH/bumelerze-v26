import type { ContentFilterTransport } from "../transport";
import type { ContentHold, FilterTerm, FilterTestResult, SurgeStatus } from "../types";

export const QUIET_SURGE: SurgeStatus = {
  active: false,
  mode: "auto",
  until: null,
  reason: null,
  eventRef: null,
  magnitude: null,
  place: null,
  reports: null,
  minMagnitude: 5,
  feltReports: 50,
  accountDays: 7,
};

export type FakeFilterTransport = {
  [K in keyof ContentFilterTransport]: jest.MockedFunction<ContentFilterTransport[K]>;
};

/** A jest-mock-backed word filter transport (migration 0059). */
export function makeFilterTransport(
  data: {
    terms?: FilterTerm[];
    surge?: SurgeStatus;
    surgeActive?: boolean;
    holds?: ContentHold[];
    test?: FilterTestResult;
  } = {},
): FakeFilterTransport {
  const transport = {
    fetchTerms: jest.fn(async () => data.terms ?? []),
    addTerm: jest.fn(async () => "new-term"),
    setTermActive: jest.fn(async () => undefined),
    testText: jest.fn(
      async () => data.test ?? { held: false, matches: [], surge: false },
    ),
    fetchSurgeStatus: jest.fn(async () => data.surge ?? QUIET_SURGE),
    setSurgeMode: jest.fn(async () => data.surge ?? QUIET_SURGE),
    fetchSurgeActive: jest.fn(async () => data.surgeActive ?? false),
    fetchHolds: jest.fn(async (_kind: "comment" | "post", ids: readonly string[]) =>
      (data.holds ?? []).filter((hold) => ids.includes(hold.targetId)),
    ),
    approvePost: jest.fn(async () => undefined),
    pinComment: jest.fn(async () => undefined),
    unpinComment: jest.fn(async () => undefined),
  };
  return transport as unknown as FakeFilterTransport;
}
