import { URMIA_EVENT } from "../__fixtures__/events";
import { shareIdFor } from "../share-id";

describe("shareIdFor", () => {
  it("prefers the event's own Bumelerze id", () => {
    expect(shareIdFor(URMIA_EVENT, "bml999")).toBe("bml202602ia");
  });
  it("then the id the route resolved", () => {
    expect(shareIdFor({ ...URMIA_EVENT, bumelerzeId: null }, "bml999")).toBe("bml999");
  });
  it("then the provider id, which the event route also accepts", () => {
    expect(shareIdFor({ ...URMIA_EVENT, bumelerzeId: null }, null)).toBe("gfz2026tksc");
  });
});
