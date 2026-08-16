import { MAP_STYLE_URLS } from "../config";
import {
  buildMapTilerStyleUrl,
  decideMapErrorAction,
  getConfiguredMapTilerKey,
  MAPTILER_STYLE_IDS,
  resolveMapStyle,
  resolveMapStyleForKey,
} from "../style-provider";

describe("buildMapTilerStyleUrl", () => {
  it("builds a style.json URL with the key as a query param", () => {
    expect(buildMapTilerStyleUrl("outdoor-v4", "abc123")).toBe(
      "https://api.maptiler.com/maps/outdoor-v4/style.json?key=abc123",
    );
  });
});

describe("resolveMapStyleForKey", () => {
  it("picks OpenFreeMap when no MapTiler key is configured", () => {
    expect(resolveMapStyleForKey("light", null)).toEqual({
      provider: "openfreemap",
      url: MAP_STYLE_URLS.light,
    });
    expect(resolveMapStyleForKey("dark", null)).toEqual({
      provider: "openfreemap",
      url: MAP_STYLE_URLS.dark,
    });
  });

  it("picks MapTiler's outdoor-v4/dataviz-v4-dark styles when a key is configured", () => {
    expect(resolveMapStyleForKey("light", "my-key")).toEqual({
      provider: "maptiler",
      url: buildMapTilerStyleUrl(MAPTILER_STYLE_IDS.light, "my-key"),
    });
    expect(resolveMapStyleForKey("dark", "my-key")).toEqual({
      provider: "maptiler",
      url: buildMapTilerStyleUrl(MAPTILER_STYLE_IDS.dark, "my-key"),
    });
  });

  it("an empty-string key is treated the same as no key (openfreemap)", () => {
    expect(resolveMapStyleForKey("light", "").provider).toBe("openfreemap");
  });

  it("forceProvider: 'openfreemap' overrides an otherwise-configured key", () => {
    expect(resolveMapStyleForKey("light", "my-key", "openfreemap")).toEqual({
      provider: "openfreemap",
      url: MAP_STYLE_URLS.light,
    });
  });
});

describe("getConfiguredMapTilerKey / resolveMapStyle (env-reading wrapper)", () => {
  const originalKey = process.env.EXPO_PUBLIC_MAPTILER_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.EXPO_PUBLIC_MAPTILER_KEY;
    } else {
      process.env.EXPO_PUBLIC_MAPTILER_KEY = originalKey;
    }
  });

  it("returns null when unset, whitespace-only, or empty", () => {
    delete process.env.EXPO_PUBLIC_MAPTILER_KEY;
    expect(getConfiguredMapTilerKey()).toBeNull();

    process.env.EXPO_PUBLIC_MAPTILER_KEY = "   ";
    expect(getConfiguredMapTilerKey()).toBeNull();

    process.env.EXPO_PUBLIC_MAPTILER_KEY = "";
    expect(getConfiguredMapTilerKey()).toBeNull();
  });

  it("trims and returns a configured key", () => {
    process.env.EXPO_PUBLIC_MAPTILER_KEY = "  my-key  ";
    expect(getConfiguredMapTilerKey()).toBe("my-key");
  });

  it("resolveMapStyle reads the key from the environment", () => {
    delete process.env.EXPO_PUBLIC_MAPTILER_KEY;
    expect(resolveMapStyle("light").provider).toBe("openfreemap");

    process.env.EXPO_PUBLIC_MAPTILER_KEY = "my-key";
    expect(resolveMapStyle("light").provider).toBe("maptiler");
  });
});

describe("decideMapErrorAction", () => {
  it("falls back to openfreemap when maptiler fails before ever reaching ready", () => {
    expect(
      decideMapErrorAction({
        provider: "maptiler",
        hasReachedReady: false,
        alreadyFellBack: false,
      }),
    ).toBe("fallback-to-openfreemap");
  });

  it("shows the error state when openfreemap itself fails (nowhere left to fall back to)", () => {
    expect(
      decideMapErrorAction({
        provider: "openfreemap",
        hasReachedReady: false,
        alreadyFellBack: false,
      }),
    ).toBe("show-error");
  });

  it("shows the error state rather than swapping basemaps out from under an already-ready map", () => {
    expect(
      decideMapErrorAction({
        provider: "maptiler",
        hasReachedReady: true,
        alreadyFellBack: false,
      }),
    ).toBe("show-error");
  });

  it("never loops — a second maptiler failure after already falling back shows the error state", () => {
    expect(
      decideMapErrorAction({
        provider: "maptiler",
        hasReachedReady: false,
        alreadyFellBack: true,
      }),
    ).toBe("show-error");
  });
});
