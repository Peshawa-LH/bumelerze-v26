import {
  abandonTwoStepSetup,
  confirmTwoStepSetup,
  isCompleteTwoStepCode,
  normalizeTwoStepCode,
  readTwoStepEnabledOnDevice,
  startTwoStepSetup,
  turnOffTwoStep,
  twoStepCodeNeeded,
  verifyTwoStepCode,
} from "../two-step";

/**
 * Two-step sign-in service (security checklist A0.1) against a mocked
 * supabase-js: which MFA calls happen, in which order, with what, and how
 * their errors reach the screens. No network.
 */

let mockClient: ReturnType<typeof makeClient> | null = null;
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
}));

type Res = { data: unknown; error: unknown };
interface MockFactor {
  id: string;
  factor_type: string;
  status: "verified" | "unverified";
}

const ACCOUNT = { id: "uid-admin", is_anonymous: false, email: "a@b.co" };
const ENROLLED = {
  id: "factor-new",
  type: "totp",
  friendly_name: "Bumelerze",
  totp: {
    qr_code: "data:image/svg+xml;utf-8,<svg/>",
    secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
    uri: "otpauth://totp/Bumelerze:a@b.co?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Bumelerze",
  },
};

function makeClient(
  opts: {
    user?: typeof ACCOUNT | { id: string; is_anonymous: boolean } | null;
    factors?: MockFactor[];
    sessionFactors?: MockFactor[];
  } = {},
) {
  const user = opts.user === undefined ? ACCOUNT : opts.user;
  const factors = opts.factors ?? [];
  const session = user
    ? {
        access_token: "access-jwt",
        user: { ...user, factors: opts.sessionFactors ?? [] },
      }
    : null;
  const ok = (data: unknown): Res => ({ data, error: null });
  return {
    auth: {
      getSession: jest.fn(async () => ({ data: { session }, error: null })),
      refreshSession: jest.fn(async () => ok({})),
      mfa: {
        listFactors: jest.fn(async (): Promise<Res> => ok({ all: factors })),
        enroll: jest.fn(async (..._a: unknown[]): Promise<Res> => ok(ENROLLED)),
        challenge: jest.fn(async (..._a: unknown[]): Promise<Res> =>
          ok({ id: "challenge-1", type: "totp", expires_at: 0 }),
        ),
        verify: jest.fn(async (..._a: unknown[]): Promise<Res> => ok({})),
        unenroll: jest.fn(async (p: { factorId: string }): Promise<Res> =>
          ok({ id: p.factorId }),
        ),
        getAuthenticatorAssuranceLevel: jest.fn(
          async (..._a: unknown[]): Promise<Res> =>
            ok({ currentLevel: "aal1", nextLevel: "aal1", currentAuthenticationMethods: [] }),
        ),
      },
    },
  };
}

const VERIFIED: MockFactor = { id: "factor-on", factor_type: "totp", status: "verified" };
const LEFTOVER: MockFactor = { id: "factor-old", factor_type: "totp", status: "unverified" };

beforeEach(() => {
  jest.clearAllMocks();
  mockClient = makeClient();
});

describe("the typed code", () => {
  it("keeps digits only and reads Sorani/Arabic and Persian keyboard digits", () => {
    expect(normalizeTwoStepCode(" 123 456 ")).toBe("123456");
    expect(normalizeTwoStepCode("١٢٣٤٥٦")).toBe("123456");
    expect(normalizeTwoStepCode("۱۲۳-۴۵۶")).toBe("123456");
    expect(isCompleteTwoStepCode("12345")).toBe(false);
    expect(isCompleteTwoStepCode("١٢٣ ٤٥٦")).toBe(true);
  });
});

describe("startTwoStepSetup", () => {
  it("removes an unverified factor left from an abandoned attempt, THEN enrolls a TOTP factor named Bumelerze", async () => {
    mockClient = makeClient({ factors: [LEFTOVER] });
    const result = await startTwoStepSetup();

    const mfa = mockClient.auth.mfa;
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-old" });
    expect(mfa.enroll).toHaveBeenCalledWith({
      factorType: "totp",
      friendlyName: "Bumelerze",
      issuer: "Bumelerze",
    });
    expect(mfa.unenroll.mock.invocationCallOrder[0] as number).toBeLessThan(
      mfa.enroll.mock.invocationCallOrder[0] as number,
    );
    expect(result).toEqual({
      kind: "setup",
      factorId: "factor-new",
      secret: ENROLLED.totp.secret,
      uri: ENROLLED.totp.uri,
    });
  });

  it("does not enroll again when two-step sign-in is already on", async () => {
    mockClient = makeClient({ factors: [VERIFIED] });
    expect(await startTwoStepSetup()).toEqual({ kind: "alreadyOn" });
    expect(mockClient.auth.mfa.enroll).not.toHaveBeenCalled();
    expect(mockClient.auth.mfa.unenroll).not.toHaveBeenCalled();
  });

  it("ignores other factor types", async () => {
    mockClient = makeClient({
      factors: [{ id: "phone-1", factor_type: "phone", status: "unverified" }],
    });
    await startTwoStepSetup();
    expect(mockClient.auth.mfa.unenroll).not.toHaveBeenCalled();
  });

  it("a leftover already removed meanwhile (abandon racing) is fine", async () => {
    mockClient = makeClient({ factors: [LEFTOVER] });
    mockClient.auth.mfa.unenroll.mockResolvedValueOnce({
      data: null,
      error: { code: "mfa_factor_not_found", status: 404, message: "Factor not found" },
    });
    await expect(startTwoStepSetup()).resolves.toMatchObject({ kind: "setup" });
  });

  it("on a name clash, clears the new leftover and enrolls once more", async () => {
    mockClient = makeClient();
    const mfa = mockClient.auth.mfa;
    mfa.enroll.mockResolvedValueOnce({
      data: null,
      error: { code: "mfa_factor_name_conflict", status: 422, message: "exists" },
    });
    mfa.listFactors
      .mockResolvedValueOnce({ data: { all: [] }, error: null })
      .mockResolvedValueOnce({ data: { all: [LEFTOVER] }, error: null });
    await expect(startTwoStepSetup()).resolves.toMatchObject({ kind: "setup" });
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-old" });
    expect(mfa.enroll).toHaveBeenCalledTimes(2);
  });

  it("needs a signed-in account (a guest, or no Supabase at all)", async () => {
    mockClient = makeClient({ user: { id: "anon", is_anonymous: true } });
    await expect(startTwoStepSetup()).rejects.toMatchObject({ code: "no_session" });
    expect(mockClient.auth.mfa.enroll).not.toHaveBeenCalled();
    mockClient = null;
    await expect(startTwoStepSetup()).rejects.toMatchObject({ code: "unconfigured" });
  });

  it("validates the enroll answer (no key, no setup)", async () => {
    mockClient?.auth.mfa.enroll.mockResolvedValueOnce({
      data: { id: "f", totp: { qr_code: "x" } },
      error: null,
    });
    await expect(startTwoStepSetup()).rejects.toMatchObject({ code: "unknown" });
  });

  it("reports no connection as such", async () => {
    mockClient?.auth.mfa.listFactors.mockResolvedValueOnce({
      data: null,
      error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" },
    });
    await expect(startTwoStepSetup()).rejects.toMatchObject({ code: "network" });
  });
});

describe("confirmTwoStepSetup (turn on)", () => {
  it("challenges the new factor, then verifies the typed code with that challenge", async () => {
    await confirmTwoStepSetup("factor-new", "١٢٣ ٤٥٦");
    const mfa = mockClient!.auth.mfa;
    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: "factor-new" });
    expect(mfa.verify).toHaveBeenCalledWith({
      factorId: "factor-new",
      challengeId: "challenge-1",
      code: "123456",
    });
    expect(mfa.challenge.mock.invocationCallOrder[0] as number).toBeLessThan(
      mfa.verify.mock.invocationCallOrder[0] as number,
    );
  });

  it("a wrong code is 'wrong_code'", async () => {
    mockClient?.auth.mfa.verify.mockResolvedValueOnce({
      data: null,
      error: { code: "mfa_verification_failed", status: 422, message: "Invalid TOTP code entered" },
    });
    await expect(confirmTwoStepSetup("factor-new", "000000")).rejects.toMatchObject({
      code: "wrong_code",
    });
  });

  it("an expired challenge is also 'wrong_code' (try the newest code)", async () => {
    mockClient?.auth.mfa.verify.mockResolvedValueOnce({
      data: null,
      error: { code: "mfa_challenge_expired", status: 422, message: "expired" },
    });
    await expect(confirmTwoStepSetup("factor-new", "000000")).rejects.toMatchObject({
      code: "wrong_code",
    });
  });

  it("an incomplete code never reaches the server", async () => {
    await expect(confirmTwoStepSetup("factor-new", "12345")).rejects.toMatchObject({
      code: "wrong_code",
    });
    expect(mockClient?.auth.mfa.challenge).not.toHaveBeenCalled();
  });

  it("too many tries is the rate-limit message, not 'wrong code'", async () => {
    mockClient?.auth.mfa.verify.mockResolvedValueOnce({
      data: null,
      error: { code: "over_request_rate_limit", status: 429, message: "Too many requests" },
    });
    await expect(confirmTwoStepSetup("factor-new", "123456")).rejects.toMatchObject({
      code: "rate_limited",
    });
  });
});

describe("abandonTwoStepSetup", () => {
  it("removes the unverified factor and never throws", async () => {
    await abandonTwoStepSetup("factor-new");
    expect(mockClient?.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-new" });
    mockClient?.auth.mfa.unenroll.mockRejectedValueOnce(new Error("offline"));
    await expect(abandonTwoStepSetup("factor-new")).resolves.toBeUndefined();
  });
});

describe("verifyTwoStepCode (sign-in, a device without a code, a password change)", () => {
  it("verifies against the account's verified factor", async () => {
    mockClient = makeClient({ factors: [LEFTOVER, VERIFIED] });
    await verifyTwoStepCode("123456");
    expect(mockClient.auth.mfa.challenge).toHaveBeenCalledWith({ factorId: "factor-on" });
    expect(mockClient.auth.mfa.verify).toHaveBeenCalledWith({
      factorId: "factor-on",
      challengeId: "challenge-1",
      code: "123456",
    });
  });

  it("does nothing when two-step sign-in was turned off meanwhile", async () => {
    await verifyTwoStepCode("123456");
    expect(mockClient?.auth.mfa.challenge).not.toHaveBeenCalled();
  });

  it("a session the server ended is 'no_session'", async () => {
    mockClient?.auth.mfa.listFactors.mockResolvedValueOnce({
      data: null,
      error: { name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" },
    });
    await expect(verifyTwoStepCode("123456")).rejects.toMatchObject({ code: "no_session" });
  });
});

describe("turnOffTwoStep", () => {
  it("verifies a code first (aal2), then removes every TOTP factor and refreshes the session", async () => {
    mockClient = makeClient({ factors: [VERIFIED, LEFTOVER] });
    await turnOffTwoStep("123456");
    const { mfa, refreshSession } = mockClient.auth;
    expect(mfa.verify).toHaveBeenCalledTimes(1);
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-on" });
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-old" });
    expect(mfa.verify.mock.invocationCallOrder[0] as number).toBeLessThan(
      mfa.unenroll.mock.invocationCallOrder[0] as number,
    );
    expect(refreshSession).toHaveBeenCalled();
  });

  it("a wrong code removes nothing", async () => {
    mockClient = makeClient({ factors: [VERIFIED] });
    mockClient.auth.mfa.verify.mockResolvedValueOnce({
      data: null,
      error: { code: "mfa_verification_failed", status: 422, message: "Invalid TOTP code entered" },
    });
    await expect(turnOffTwoStep("000000")).rejects.toMatchObject({ code: "wrong_code" });
    expect(mockClient.auth.mfa.unenroll).not.toHaveBeenCalled();
  });

  it("a refused removal (the server wants aal2) is reported", async () => {
    mockClient = makeClient({ factors: [VERIFIED] });
    mockClient.auth.mfa.unenroll.mockResolvedValueOnce({
      data: null,
      error: { code: "insufficient_aal", status: 403, message: "AAL2 required to unenroll verified factor" },
    });
    await expect(turnOffTwoStep("123456")).rejects.toMatchObject({ code: "code_needed" });
  });
});

describe("twoStepCodeNeeded", () => {
  it("is true only for aal1 with aal2 possible", async () => {
    const aal = mockClient!.auth.mfa.getAuthenticatorAssuranceLevel;
    aal.mockResolvedValueOnce({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    expect(await twoStepCodeNeeded()).toBe(true);
    aal.mockResolvedValueOnce({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    expect(await twoStepCodeNeeded()).toBe(false);
    aal.mockResolvedValueOnce({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
    expect(await twoStepCodeNeeded()).toBe(false);
  });

  it("reads the stored session by default, and asks the server with the access token when fresh", async () => {
    const aal = mockClient!.auth.mfa.getAuthenticatorAssuranceLevel;
    await twoStepCodeNeeded();
    expect(aal).toHaveBeenLastCalledWith(undefined);
    await twoStepCodeNeeded({ fresh: true });
    expect(aal).toHaveBeenLastCalledWith("access-jwt");
  });

  it("says no for guests, without a session, on errors and without Supabase", async () => {
    mockClient = makeClient({ user: { id: "anon", is_anonymous: true } });
    expect(await twoStepCodeNeeded({ fresh: true })).toBe(false);
    expect(mockClient.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
    mockClient = makeClient({ user: null });
    expect(await twoStepCodeNeeded({ fresh: true })).toBe(false);
    mockClient = makeClient();
    mockClient.auth.mfa.getAuthenticatorAssuranceLevel.mockRejectedValueOnce(
      new Error("offline"),
    );
    expect(await twoStepCodeNeeded()).toBe(false);
    mockClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    expect(await twoStepCodeNeeded()).toBe(false);
    mockClient = null;
    expect(await twoStepCodeNeeded()).toBe(false);
  });
});

describe("status", () => {
  it("readTwoStepEnabledOnDevice reads the stored session only, and never throws", async () => {
    mockClient = makeClient({ sessionFactors: [VERIFIED] });
    expect(await readTwoStepEnabledOnDevice()).toBe(true);
    expect(mockClient.auth.mfa.listFactors).not.toHaveBeenCalled();
    mockClient = makeClient({ sessionFactors: [LEFTOVER] });
    expect(await readTwoStepEnabledOnDevice()).toBe(false);
    mockClient.auth.getSession.mockRejectedValueOnce(new Error("storage"));
    expect(await readTwoStepEnabledOnDevice()).toBe(false);
  });
});
