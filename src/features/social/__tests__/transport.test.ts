import {
  parseFeltTimeline,
  parseFeltTowns,
  parseLikeState,
  parsePostCommentLikes,
  parseProfileHeader,
} from "../transport";

/** The 0065 answers as the screens read them: anything off-contract is
 * dropped or read as "nothing", never thrown on. */
describe("social transport parsers (migration 0065)", () => {
  it("reads a heart state, and nothing for a broken answer", () => {
    expect(parseLikeState({ count: 3, liked: true })).toEqual({ count: 3, liked: true });
    expect(parseLikeState({ count: "4" })).toEqual({ count: 4, liked: false });
    expect(parseLikeState(null)).toEqual({ count: 0, liked: false });
  });

  it("reads towns: id, count and a level only where the server gave one", () => {
    expect(
      parseFeltTowns([
        { town_id: "halabja", reports: 9, level: 7 },
        { town_id: "kalar", reports: 1, level: null },
        { town_id: "broken" },
        { town_id: "empty", reports: 0, level: null },
      ]),
    ).toEqual([
      { townId: "halabja", reports: 9, level: 7 },
      { townId: "kalar", reports: 1, level: null },
    ]);
    expect(parseFeltTowns(null)).toEqual([]);
  });

  it("reads the first day: always 24 hourly buckets", () => {
    const timeline = parseFeltTimeline({
      total: 7,
      first_day: 7,
      first_hour: 4,
      minutes_to_first: 10,
      hours: [4, 0, 2, 1],
    });
    expect(timeline?.hours).toHaveLength(24);
    expect(timeline?.hours.slice(0, 4)).toEqual([4, 0, 2, 1]);
    expect(timeline?.minutesToFirst).toBe(10);
    expect(parseFeltTimeline(null)).toBeNull();
    expect(
      parseFeltTimeline({
        total: 0,
        first_day: 0,
        first_hour: 0,
        minutes_to_first: null,
        hours: [],
      })?.minutesToFirst,
    ).toBeNull();
  });

  it("reads comment hearts by comment id", () => {
    expect(
      parsePostCommentLikes([
        { comment_id: "a", likes: 2, liked: true },
        { comment_id: "b", likes: "1", liked: false },
        { likes: 5 },
      ]),
    ).toEqual({ a: { count: 2, liked: true }, b: { count: 1, liked: false } });
  });

  it("reads the profile header, with names falling back to the @username", () => {
    expect(
      parseProfileHeader({
        posts: 6,
        followers: 88,
        following: 140,
        followed_by: [
          { username: "dilan.k", display_name: "Dilan" },
          { username: "shno.m", display_name: null },
        ],
        followed_by_total: 2,
      }),
    ).toEqual({
      posts: 6,
      followers: 88,
      following: 140,
      followedBy: [
        { username: "dilan.k", displayName: "Dilan" },
        { username: "shno.m", displayName: "shno.m" },
      ],
      followedByTotal: 2,
    });
    expect(parseProfileHeader(null)).toBeNull();
  });
});
