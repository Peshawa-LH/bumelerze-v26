import type { PeopleTransport } from "../transport";
import type {
  PeoplePage,
  PeopleStats,
  PersonDetail,
  PersonNote,
  PersonRow,
} from "../types";

export const DAY = 86_400_000;

export function row(overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    userId: "c2c2c2c2-0000-4000-8000-000000000000",
    kind: "account",
    username: "aso",
    displayName: "Aso Kareem",
    avatarPath: null,
    ranks: [],
    status: "active",
    joined: Date.now() - 30 * DAY,
    lastSeen: Date.now() - DAY,
    platform: "android",
    openReports: 0,
    counts: {
      feltReports: 2,
      comments: 5,
      posts: 1,
      homesOwned: 1,
      homesMember: 0,
      feedback: 1,
    },
    maskedEmail: null,
    ...overrides,
  };
}

export function page(rows: PersonRow[], extra: Partial<PeoplePage> = {}): PeoplePage {
  return { rows, nextCursor: null, idleGuests: null, ...extra };
}

export function stats(overrides: Partial<PeopleStats> = {}): PeopleStats {
  return {
    accountsTotal: 1234,
    guestsTotal: 56,
    newAccounts7d: 12,
    newAccounts30d: 80,
    activeAccounts7d: 40,
    activeAccounts30d: 90,
    activeGuests7d: 5,
    activeGuests30d: 9,
    presenceSince: Date.parse("2026-10-09T10:00:00Z"),
    restricted: 3,
    suspended: 1,
    platforms: { ios: 10, android: 25, web: 2 },
    ...overrides,
  };
}

export function detail(overrides: Partial<PersonDetail> = {}): PersonDetail {
  const base: PersonDetail = {
    identity: {
      userId: "c2c2c2c2-0000-4000-8000-000000000000",
      kind: "account",
      username: "aso",
      displayName: "Aso Kareem",
      avatarPath: "c2c2c2c2/avatar.jpg",
      isPrivate: false,
      ranks: [],
      status: "active",
      joined: Date.now() - 30 * DAY,
      firstSeen: Date.now() - 10 * DAY,
      lastSeen: Date.now() - DAY,
      platform: "android",
      appVersion: "1.2.3",
      locale: "ckb",
      termsVersion: "t1",
      termsAcceptedAt: Date.now() - 30 * DAY,
      researchConsentVersion: null,
      researchConsentAt: null,
      maskedEmail: "a***@x.org",
      hasPassword: true,
    },
    devices: [
      {
        fingerprint: "1f2e3d4c",
        firstSeen: Date.now() - 20 * DAY,
        lastSeen: Date.now() - DAY,
        feltReports: 2,
        feedback: 1,
        platform: "android",
      },
    ],
    sameDeviceUsers: [],
    counts: {
      feltReports: 2,
      comments: 5,
      commentsVisible: 1,
      commentsPending: 1,
      commentsHidden: 2,
      commentsRemoved: 1,
      posts: 2,
      feedback: 1,
      followers: 2,
      following: 1,
      blocksMade: 1,
      blocksReceived: 1,
      reportsFiled: 0,
      reportsReceived: 3,
      reportsOpen: 2,
      homesOwned: 1,
      homesMember: 0,
      notes: 0,
    },
    recent: {
      feltReports: [
        { reportId: "fr1", createdAt: Date.now() - DAY, event: "bml2026aa", intensity: 5 },
      ],
      comments: [
        {
          commentId: "cm1",
          createdAt: Date.now() - DAY,
          event: "bml2026aa",
          status: "visible",
          authorDeleted: false,
          excerpt: "I felt it strongly",
        },
        {
          commentId: "cm2",
          createdAt: Date.now() - 2 * DAY,
          event: "bml2026aa",
          status: "hidden",
          authorDeleted: true,
          excerpt: null,
        },
      ],
      posts: [
        { postId: "po1", createdAt: Date.now() - DAY, status: "visible", excerpt: "Hello from Duhok" },
      ],
      feedback: [{ feedbackId: "fb1", createdAt: Date.now() - DAY, category: "bug", status: "unseen" }],
    },
    restrictions: [],
  };
  return { ...base, ...overrides };
}

export function note(overrides: Partial<PersonNote> = {}): PersonNote {
  return {
    id: "n1",
    body: "Watch this one",
    createdAt: Date.now() - DAY,
    authorId: "m1",
    authorName: "Mona",
    ...overrides,
  };
}

export function fakePeopleTransport(
  data: {
    pages?: PeoplePage[];
    stats?: PeopleStats;
    person?: PersonDetail;
    notes?: PersonNote[];
  } = {},
): jest.Mocked<PeopleTransport> {
  const pages = data.pages ?? [page([row()])];
  let call = 0;
  return {
    search: jest.fn(async () => pages[Math.min(call++, pages.length - 1)] as PeoplePage),
    stats: jest.fn(async () => data.stats ?? stats()),
    person: jest.fn(async () => data.person ?? detail()),
    revealEmail: jest.fn(async () => "aso@x.org"),
    resetProfile: jest.fn(async () => "log-1"),
    notes: jest.fn(async () => data.notes ?? []),
    addNote: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<PeopleTransport>;
}
