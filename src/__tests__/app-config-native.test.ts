import config, { expoAccountConfig } from "../../app.config";

/** iOS/Android build settings in app.config.ts (the web build ignores them). */
describe("app.config native build identity", () => {
  it("ties EAS Updates to the app version", () => {
    expect(config.runtimeVersion).toEqual({ policy: "appVersion" });
  });

  it("names no Expo owner or project while the environment has none", () => {
    expect(expoAccountConfig({})).toEqual({});
    expect(expoAccountConfig({ EXPO_OWNER: "  ", EAS_PROJECT_ID: "" })).toEqual({});
  });

  it("reads the owner and the project id from the environment after `eas init`", () => {
    expect(
      expoAccountConfig({
        EXPO_OWNER: "bumelerze",
        EAS_PROJECT_ID: " 0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7 ",
      }),
    ).toEqual({
      owner: "bumelerze",
      extra: { eas: { projectId: "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7" } },
    });
  });
});
