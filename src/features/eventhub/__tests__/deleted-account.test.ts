import { isDeletedAccountComment } from "../deleted-account";

describe("isDeletedAccountComment", () => {
  it("is a visible comment with no author and no text", () => {
    expect(isDeletedAccountComment({ userId: null, body: "", status: "visible" })).toBe(
      true,
    );
  });

  it("is not a comment that still has an author or text", () => {
    expect(isDeletedAccountComment({ userId: "u1", body: "", status: "visible" })).toBe(
      false,
    );
    expect(isDeletedAccountComment({ userId: null, body: "hi", status: "visible" })).toBe(
      false,
    );
  });

  it("is not a removed or hidden comment (those have their own placeholders)", () => {
    expect(isDeletedAccountComment({ userId: null, body: "", status: "removed" })).toBe(
      false,
    );
    expect(isDeletedAccountComment({ userId: null, body: "", status: "hidden" })).toBe(
      false,
    );
    expect(isDeletedAccountComment({ userId: null, body: "", status: "pending" })).toBe(
      false,
    );
  });
});
