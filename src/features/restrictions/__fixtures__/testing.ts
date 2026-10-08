import type { RestrictionsTransport } from "../transport";
import type { AdminRestriction, MyRestriction } from "../types";

export const DAY = 86_400_000;

export function mine(overrides: Partial<MyRestriction> = {}): MyRestriction {
  return {
    id: "r1",
    level: "restrict",
    reason: "rumour",
    startsAt: Date.now() - 3_600_000,
    endsAt: Date.now() + DAY,
    appealRequestedAt: null,
    ...overrides,
  };
}

export function adminRow(overrides: Partial<AdminRestriction> = {}): AdminRestriction {
  return {
    id: "r1",
    userId: "11111111-2222-3333-4444-555555555555",
    userName: "Dilan",
    userUsername: "dilan.k",
    isGuest: false,
    level: "restrict",
    reason: "harassment",
    note: null,
    startsAt: Date.now() - 3_600_000,
    endsAt: Date.now() + DAY,
    createdAt: Date.now() - 3_600_000,
    createdByName: "Mona",
    liftedAt: null,
    liftedByName: null,
    appealRequestedAt: null,
    active: true,
    ...overrides,
  };
}

export function fakeTransport(
  data: { mine?: MyRestriction | null; rows?: AdminRestriction[] } = {},
): jest.Mocked<RestrictionsTransport> {
  return {
    fetchMine: jest.fn(async () => data.mine ?? null),
    requestReview: jest.fn(async () => undefined),
    restrict: jest.fn(async () => "new-restriction"),
    lift: jest.fn(async () => undefined),
    fetchAdminList: jest.fn(async () => data.rows ?? []),
  } as unknown as jest.Mocked<RestrictionsTransport>;
}
