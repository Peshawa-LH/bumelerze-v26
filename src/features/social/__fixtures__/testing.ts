import type {
  FeltTimeline,
  FeltTown,
  LikeState,
  ProfileHeaderInfo,
  SocialTransport,
} from "../transport";

/** What a fake social transport (migration 0065) answers with. */
export interface FakeSocialData {
  hubLikes?: LikeState;
  towns?: FeltTown[];
  timeline?: FeltTimeline | null;
  postCommentLikes?: Record<string, LikeState>;
  header?: ProfileHeaderInfo | null;
}

export type FakeSocialTransport = {
  [K in keyof SocialTransport]: jest.MockedFunction<SocialTransport[K]>;
};

/** A jest-mock-backed social transport; every method is a `jest.fn`. */
export function makeSocialTransport(
  data: FakeSocialData = {},
  overrides: Partial<SocialTransport> = {},
): FakeSocialTransport {
  let hub: LikeState = data.hubLikes ?? { count: 0, liked: false };
  const transport = {
    fetchHubLikes: jest.fn(async () => hub),
    setHubLike: jest.fn(async (_event: string, like: boolean) => {
      hub = {
        liked: like,
        count: Math.max(0, hub.count + (like === hub.liked ? 0 : like ? 1 : -1)),
      };
      return hub;
    }),
    fetchFeltTowns: jest.fn(async () => data.towns ?? []),
    fetchFeltTimeline: jest.fn(async () => data.timeline ?? null),
    fetchPostCommentLikes: jest.fn(async () => data.postCommentLikes ?? {}),
    setPostCommentLike: jest.fn(async (_id: string, like: boolean) => ({
      liked: like,
      count: like ? 1 : 0,
    })),
    fetchProfileHeader: jest.fn(async () => data.header ?? null),
    ...overrides,
  };
  return transport as unknown as FakeSocialTransport;
}

/** A first day of reports: 4 in hour 0, 2 in hour 2, 1 in hour 3. */
export const TIMELINE: FeltTimeline = {
  total: 7,
  firstDay: 7,
  firstHour: 4,
  minutesToFirst: 4,
  hours: [4, 0, 2, 1, ...Array.from({ length: 20 }, () => 0)],
};
