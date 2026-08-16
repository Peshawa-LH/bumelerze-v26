module.exports = function (api) {
  api.cache(true);

  const plugins = [];

  // Metro (real dev/prod builds) has first-class support for `import()` —
  // it code-splits and lazily loads the chunk natively, no Babel help
  // needed (`app/(tabs)/map.web.tsx`'s lazy `import("maplibre-gl")` relies
  // on exactly this for its "only pay for the map bundle if you open the
  // Map tab" behavior). Jest, though, runs source directly under Node's
  // CommonJS-only module loader, which can't evaluate a literal `import()`
  // expression at all without `--experimental-vm-modules` — this plugin
  // rewrites it to `Promise.resolve().then(() => require(...))` so the
  // exact same source works under both. Scoped to the Jest run only
  // (`NODE_ENV === "test"`, which Jest sets automatically) so Metro's own
  // bundling is never touched by it.
  if (process.env.NODE_ENV === "test") {
    plugins.push("babel-plugin-dynamic-import-node");
  }

  return {
    presets: ["babel-preset-expo"],
    plugins,
  };
};
