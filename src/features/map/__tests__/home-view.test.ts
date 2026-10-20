import { homeBboxAround } from "../home-view";

describe("homeBboxAround", () => {
  it("frames about 150 km around the reader, the same spans as the web map's Home", () => {
    expect(homeBboxAround(35.56, 45.43)).toEqual({
      minLat: 35.56 - 0.7,
      maxLat: 35.56 + 0.7,
      minLon: 45.43 - 0.9,
      maxLon: 45.43 + 0.9,
    });
  });
});
