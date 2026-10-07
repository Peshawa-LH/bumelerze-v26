import { POST_MAX_LENGTH } from "../constants";
import { validatePostBody } from "../validation";

describe("validatePostBody", () => {
  it("rejects empty and whitespace-only text", () => {
    expect(validatePostBody("")).toBe("empty");
    expect(validatePostBody("   \n\t  ")).toBe("empty");
  });

  it("accepts 1 to 500 characters after trimming", () => {
    expect(validatePostBody("a")).toBeNull();
    expect(validatePostBody("x".repeat(POST_MAX_LENGTH))).toBeNull();
    expect(validatePostBody(`  ${"x".repeat(POST_MAX_LENGTH)}  `)).toBeNull();
  });

  it("rejects more than 500 characters", () => {
    expect(validatePostBody("x".repeat(POST_MAX_LENGTH + 1))).toBe("too_long");
  });

  it("counts Sorani text like any other text", () => {
    expect(validatePostBody("زەوی لەرزی")).toBeNull();
  });
});
