import { validateProfileForm } from "../validation";

describe("validateProfileForm", () => {
  it("requires a trimmed name of 2 to 40 characters", () => {
    expect(validateProfileForm({ displayName: "A", termsAccepted: true }).nameValid).toBe(false);
    expect(validateProfileForm({ displayName: "  A  ", termsAccepted: true }).nameValid).toBe(false);
    expect(validateProfileForm({ displayName: "Ab", termsAccepted: true }).nameValid).toBe(true);
    expect(validateProfileForm({ displayName: "x".repeat(40), termsAccepted: true }).nameValid).toBe(true);
    expect(validateProfileForm({ displayName: "x".repeat(41), termsAccepted: true }).nameValid).toBe(false);
  });

  it("requires the terms", () => {
    const result = validateProfileForm({ displayName: "Shilan", termsAccepted: false });
    expect(result.termsValid).toBe(false);
    expect(result.valid).toBe(false);
    expect(validateProfileForm({ displayName: "Shilan", termsAccepted: true }).valid).toBe(true);
  });
});
