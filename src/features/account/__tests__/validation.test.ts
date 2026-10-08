import {
  isAcceptablePassword,
  validateCreateAccount,
  validateNewPassword,
  validateProfileForm,
} from "../validation";

describe("validateProfileForm", () => {
  it("requires a trimmed name of 2 to 40 characters", () => {
    expect(validateProfileForm({ displayName: "A", termsAccepted: true }).nameValid).toBe(
      false,
    );
    expect(
      validateProfileForm({ displayName: "  A  ", termsAccepted: true }).nameValid,
    ).toBe(false);
    expect(
      validateProfileForm({ displayName: "Ab", termsAccepted: true }).nameValid,
    ).toBe(true);
    expect(
      validateProfileForm({ displayName: "x".repeat(40), termsAccepted: true }).nameValid,
    ).toBe(true);
    expect(
      validateProfileForm({ displayName: "x".repeat(41), termsAccepted: true }).nameValid,
    ).toBe(false);
  });

  it("requires the terms", () => {
    const result = validateProfileForm({ displayName: "Shilan", termsAccepted: false });
    expect(result.termsValid).toBe(false);
    expect(result.valid).toBe(false);
    expect(
      validateProfileForm({ displayName: "Shilan", termsAccepted: true }).valid,
    ).toBe(true);
  });
});

describe("username in the profile form", () => {
  it("is optional, but must follow the database rule when given", () => {
    const base = { displayName: "Shilan", termsAccepted: true };
    expect(validateProfileForm({ ...base }).valid).toBe(true);
    expect(validateProfileForm({ ...base, username: "" }).valid).toBe(true);
    expect(validateProfileForm({ ...base, username: "shilan.k" }).valid).toBe(true);
    expect(validateProfileForm({ ...base, username: "@Shilan" }).valid).toBe(true);
    expect(validateProfileForm({ ...base, username: "sh" })).toMatchObject({
      usernameValid: false,
      valid: false,
    });
    expect(validateProfileForm({ ...base, username: "has space" }).valid).toBe(false);
  });
});

describe("validateCreateAccount", () => {
  const ok = { email: "a@b.co", emailAgain: "a@b.co", password: "correct horse" };

  it("accepts a matching email pair and a password of 8 or more characters", () => {
    expect(validateCreateAccount(ok)).toBeNull();
    expect(validateCreateAccount({ ...ok, password: "12345678" })).toBeNull();
  });

  it("checks the email shape first, then that the two emails match (case-insensitive)", () => {
    expect(validateCreateAccount({ ...ok, email: "nope", emailAgain: "nope" })).toBe(
      "invalid_email",
    );
    expect(validateCreateAccount({ ...ok, emailAgain: "a@c.co" })).toBe("email_mismatch");
    expect(
      validateCreateAccount({ ...ok, email: " A@B.co ", emailAgain: "a@b.CO" }),
    ).toBeNull();
  });

  it("rejects passwords shorter than 8 or longer than 72", () => {
    expect(validateCreateAccount({ ...ok, password: "1234567" })).toBe("weak_password");
    expect(validateCreateAccount({ ...ok, password: "x".repeat(72) })).toBeNull();
    expect(validateCreateAccount({ ...ok, password: "x".repeat(73) })).toBe(
      "weak_password",
    );
  });
});

describe("validateNewPassword", () => {
  it("needs 8..72 characters and an identical second copy", () => {
    expect(validateNewPassword({ password: "short", passwordAgain: "short" })).toBe(
      "weak_password",
    );
    expect(
      validateNewPassword({ password: "long enough", passwordAgain: "long enougH" }),
    ).toBe("password_mismatch");
    expect(
      validateNewPassword({ password: "long enough", passwordAgain: "long enough" }),
    ).toBeNull();
  });

  it("keeps spaces: a passphrase is not trimmed", () => {
    expect(isAcceptablePassword("       a")).toBe(true);
    expect(isAcceptablePassword("a       ")).toBe(true);
  });
});
