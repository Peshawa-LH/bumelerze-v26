import config from "../../app.config";

/** The expo-router plugin options the live web app depends on. */
describe("app.config expo-router plugin", () => {
  const routerPlugin = (config.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-router",
  ) as [string, Record<string, unknown>] | undefined;

  it("is configured", () => {
    expect(routerPlugin).toBeDefined();
  });

  it("keeps async routes off (the tab bar opened /world with them on)", () => {
    expect(routerPlugin?.[1].asyncRoutes).toBe(false);
  });

  it("generates no /_sitemap route (a dev tool listing every route file; review B-1)", () => {
    expect(routerPlugin?.[1].sitemap).toBe(false);
  });
});
