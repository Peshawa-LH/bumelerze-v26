import {
  aboutChanged,
  hasLink,
  normalizeBio,
  parseProfileAbout,
  saveProfileAbout,
  validateBio,
} from "../about";
import { toUsernameAwareError } from "../service";

const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
  isSupabaseConfigured: () => true,
  resetAnonymousSignIn: jest.fn(),
  signInAnonymously: jest.fn(),
}));
const mockAccept = jest.fn();
jest.mock("@/features/guidelines/transport", () => ({
  SupabaseGuidelinesTransport: { accept: (...args: unknown[]) => mockAccept(...args) },
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockAccept.mockReset();
});

describe("bio rules (mirror of migration 0058)", () => {
  it("folds whitespace and trims", () => {
    expect(normalizeBio("  Volunteer\n\n in   Duhok ")).toBe("Volunteer in Duhok");
  });

  it("allows 160 characters, not 161", () => {
    expect(validateBio("x".repeat(160))).toBeNull();
    expect(validateBio("x".repeat(161))).toBe("bio_too_long");
  });

  it("refuses links, keeps ordinary text", () => {
    for (const bad of [
      "https://evil.example",
      "www.spam.org",
      "t.me/abc",
      "mysite.com",
      "erbil.krd now",
    ]) {
      expect([bad, hasLink(bad)]).toEqual([bad, true]);
      expect(validateBio(bad)).toBe("bio_link");
    }
    for (const good of [
      "Seismologist, Erbil. M5.1 felt",
      "e.g. engineer",
      "Dr.Kamal",
      "Iraq.Erbil",
      "ئەندازیار لە هەولێر",
    ]) {
      expect([good, hasLink(good)]).toEqual([good, false]);
    }
  });
});

describe("parseProfileAbout", () => {
  it("reads the about fields and the name-change allowance", () => {
    expect(
      parseProfileAbout({
        bio: "Hi",
        city_place_id: "duhok",
        city_name: "Duhok",
        pinned_post_id: "p1",
        username_next_change_at: "2026-11-01T00:00:00Z",
        display_name_changes_left: 2,
        display_name_next_change_at: null,
        lat: 36.8,
      }),
    ).toEqual({
      bio: "Hi",
      city: { placeId: "duhok", name: "Duhok" },
      pinnedPostId: "p1",
      usernameNextChangeAt: Date.parse("2026-11-01T00:00:00Z"),
      displayNameChangesLeft: 2,
      displayNameNextChangeAt: null,
    });
  });

  it("a half city is no city", () => {
    expect(
      parseProfileAbout({ city_place_id: "duhok", city_name: null })?.city,
    ).toBeNull();
  });
});

describe("saveProfileAbout", () => {
  it("sends the text, a place id and a place name, and nothing else", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await saveProfileAbout({
      bio: "  Hi  there ",
      city: { placeId: "duhok", name: "Duhok" },
    });
    expect(mockRpc).toHaveBeenCalledWith("set_profile_about", {
      p_bio: "Hi there",
      p_city_place_id: "duhok",
      p_city_name: "Duhok",
    });
    const args = mockRpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["p_bio", "p_city_name", "p_city_place_id"]);
    expect(JSON.stringify(args)).not.toMatch(/lat|lon|coord|geohash/i);
  });

  it("clears with nulls", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await saveProfileAbout({ bio: "   ", city: null });
    expect(mockRpc).toHaveBeenCalledWith("set_profile_about", {
      p_bio: null,
      p_city_place_id: null,
      p_city_name: null,
    });
  });

  it("records the guidelines (covered by the form's terms) and tries once more", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42501", message: "profiles: guidelines_required" },
      })
      .mockResolvedValueOnce({ data: null, error: null });
    mockAccept.mockResolvedValue(undefined);
    await saveProfileAbout({ bio: "Hi", city: null });
    expect(mockAccept).toHaveBeenCalledWith("signup");
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it("maps the server's refusals to clear codes", async () => {
    for (const [message, code] of [
      ["profiles: bio_link", "bio_link"],
      ["profiles: bio_too_long", "bio_too_long"],
      ["profiles: city_invalid", "city_invalid"],
      ["profiles: account_restricted", "restricted"],
    ] as const) {
      mockRpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message } });
      await expect(saveProfileAbout({ bio: "x", city: null })).rejects.toMatchObject({
        code,
      });
    }
  });
});

describe("name change limits (server-enforced) get clear codes", () => {
  it("maps the @username and display name limits", () => {
    expect(
      toUsernameAwareError({ code: "54000", message: "profiles: username_change_limit" })
        .code,
    ).toBe("username_change_limit");
    expect(
      toUsernameAwareError({
        code: "54000",
        message: "profiles: display_name_change_limit",
      }).code,
    ).toBe("name_change_limit");
  });
});

describe("aboutChanged", () => {
  const stored = {
    bio: "Hi",
    city: { placeId: "duhok", name: "Duhok" },
    pinnedPostId: null,
    usernameNextChangeAt: null,
    displayNameChangesLeft: 5,
    displayNameNextChangeAt: null,
  };
  it("is false for the same values (whitespace aside), true otherwise", () => {
    expect(
      aboutChanged({ bio: " Hi ", city: { placeId: "duhok", name: "Duhok" } }, stored),
    ).toBe(false);
    expect(aboutChanged({ bio: "Hi!", city: stored.city }, stored)).toBe(true);
    expect(aboutChanged({ bio: "Hi", city: null }, stored)).toBe(true);
    expect(aboutChanged({ bio: "", city: null }, null)).toBe(false);
  });
});
