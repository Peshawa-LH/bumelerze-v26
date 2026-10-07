import { loadProfile, saveProfile, toUsernameAwareError } from "../service";
import { AccountError } from "../types";
import { TERMS_VERSION } from "../constants";

/** Profile loading and saving with the community fields (usernames, private
 * accounts, hide-badges; migration 0045), including a server that does not
 * have those columns yet. */
let mockClient: ReturnType<typeof makeClient> | null = null;
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => mockClient,
  signInAnonymously: jest.fn(),
  resetAnonymousSignIn: jest.fn(),
}));
jest.mock("@/features/felt/device-id", () => ({
  getDeviceId: async () => "device-1234-abcd",
}));

type Result = { data: unknown; error: { code?: string; message?: string } | null };

/** Select builder that answers by the column list asked for. */
function makeClient(options: { community: boolean }) {
  const selects: string[] = [];
  const upsert = jest.fn(async (..._args: unknown[]): Promise<Result> => ({
    data: null,
    error: null,
  }));
  const from = jest.fn((table: string) => ({
    select: (columns: string) => {
      selects.push(`${table}:${columns}`);
      const hasNew = /username|is_private|hide_badges/.test(columns);
      const result: Result =
        hasNew && !options.community
          ? { data: null, error: { code: "42703", message: "column does not exist" } }
          : table === "profiles"
            ? {
                data: {
                  user_id: "uid-1",
                  display_name: "Shilan",
                  avatar_path: null,
                  ...(hasNew ? { username: "shilan", is_private: true } : {}),
                },
                error: null,
              }
            : {
                data: {
                  profession: null,
                  locale: "en",
                  terms_version: TERMS_VERSION,
                  terms_accepted_at: "x",
                  research_consent_version: null,
                  research_consent_at: null,
                  ...(hasNew ? { hide_badges: true } : {}),
                },
                error: null,
              };
      return { eq: () => ({ maybeSingle: async () => result }) };
    },
    upsert,
  }));
  return {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { user: { id: "uid-1", is_anonymous: false } } },
      })),
    },
    from,
    upsert,
    selects,
    storage: { from: jest.fn() },
  };
}

const base = {
  displayName: "Shilan",
  profession: null,
  termsAccepted: true,
  researchConsent: false,
  avatar: { kind: "keep" } as const,
  locale: "en",
};

describe("loadProfile", () => {
  it("reads username, private flag and hide-badges when the server has them", async () => {
    mockClient = makeClient({ community: true });
    const { profile, privateProfile } = await loadProfile("uid-1");
    expect(profile).toMatchObject({
      username: "shilan",
      isPrivate: true,
      communityReady: true,
    });
    expect(privateProfile?.hideBadges).toBe(true);
  });

  it("falls back to the old columns before migration 0045 and marks community as not ready", async () => {
    mockClient = makeClient({ community: false });
    const { profile, privateProfile } = await loadProfile("uid-1");
    expect(profile).toMatchObject({
      displayName: "Shilan",
      username: null,
      isPrivate: false,
      communityReady: false,
    });
    expect(privateProfile?.hideBadges).toBe(false);
    expect(privateProfile?.termsVersion).toBe(TERMS_VERSION);
  });
});

describe("saveProfile community fields", () => {
  beforeEach(() => {
    mockClient = makeClient({ community: true });
  });

  it("sends the username (normalised) and the switches only when they changed", async () => {
    await saveProfile({
      ...base,
      username: " @Shilan.K ",
      isPrivate: true,
      hideBadges: true,
      previous: {
        profile: {
          userId: "uid-1",
          displayName: "Shilan",
          avatarPath: null,
          username: null,
          isPrivate: false,
          communityReady: true,
        },
        privateProfile: null,
      },
    });
    const [publicRow] = mockClient?.upsert.mock.calls[0] ?? [];
    expect(publicRow).toMatchObject({ username: "shilan.k", is_private: true });
    const [privateRow] = mockClient?.upsert.mock.calls[1] ?? [];
    expect(privateRow).toMatchObject({ hide_badges: true });
  });

  it("leaves the community columns out when nothing changed (safe before the migration)", async () => {
    await saveProfile({
      ...base,
      username: "shilan",
      isPrivate: false,
      hideBadges: false,
      previous: {
        profile: {
          userId: "uid-1",
          displayName: "Shilan",
          avatarPath: null,
          username: "shilan",
          isPrivate: false,
          communityReady: true,
        },
        privateProfile: null,
      },
    });
    const [publicRow] = mockClient?.upsert.mock.calls[0] ?? [];
    expect(publicRow).toEqual({ user_id: "uid-1", display_name: "Shilan" });
    const [privateRow] = mockClient?.upsert.mock.calls[1] ?? [];
    expect(privateRow).not.toHaveProperty("hide_badges");
  });

  it("rejects an invalid username before any write", async () => {
    await expect(saveProfile({ ...base, username: "no spaces" })).rejects.toMatchObject({
      code: "username_invalid",
    });
    expect(mockClient?.from).not.toHaveBeenCalled();
  });

  it("maps a taken name to username_taken", async () => {
    mockClient?.upsert.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "profiles_username_lower_key"',
      },
    });
    await expect(saveProfile({ ...base, username: "taken.name" })).rejects.toMatchObject({
      code: "username_taken",
    });
  });
});

describe("toUsernameAwareError", () => {
  it("maps the reserved-name guard and the format check", () => {
    expect(
      toUsernameAwareError({ code: "23514", message: "profiles: username_reserved" })
        .code,
    ).toBe("username_reserved");
    expect(
      toUsernameAwareError({
        code: "23514",
        message: 'violates check constraint "profiles_username_format"',
      }).code,
    ).toBe("username_invalid");
    expect(toUsernameAwareError(new AccountError("network")).code).toBe("network");
  });
});
