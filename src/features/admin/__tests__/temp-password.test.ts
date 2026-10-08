import { TEMP_PASSWORD_ALPHABET, generateTempPassword } from "../temp-password";

jest.mock("expo-crypto", () => ({
  getRandomBytes: (length: number) =>
    Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 255),
}));

describe("generateTempPassword", () => {
  it("makes three dash-separated groups of four unambiguous characters", () => {
    const password = generateTempPassword();
    expect(password).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(password).not.toMatch(/[IO01]/);
    expect(password.length).toBeGreaterThanOrEqual(8); // the server's minimum
  });

  it("uses an alphabet of exactly 32 characters, so masking a byte to 5 bits is unbiased", () => {
    expect(TEMP_PASSWORD_ALPHABET).toHaveLength(32);
    expect(new Set(TEMP_PASSWORD_ALPHABET).size).toBe(32);
  });

  it("maps bytes deterministically from the injected source", () => {
    const zeros = () => new Uint8Array(12);
    expect(generateTempPassword(zeros)).toBe("AAAA-AAAA-AAAA");
    const maxed = () => new Uint8Array(12).fill(255);
    expect(generateTempPassword(maxed)).toBe("9999-9999-9999");
  });

  it("differs between calls with different randomness", () => {
    const a = generateTempPassword(() => Uint8Array.from({ length: 12 }, (_, i) => i));
    const b = generateTempPassword(() =>
      Uint8Array.from({ length: 12 }, (_, i) => i + 5),
    );
    expect(a).not.toBe(b);
  });
});
