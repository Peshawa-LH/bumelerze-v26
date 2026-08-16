const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/functions/** runs on Deno (npm:/.ts-extension imports, Deno
    // globals) — a different module system/runtime than this project's
    // Node/RN ESLint config understands (see tsconfig.json's matching
    // exclude for the same reason). Its tests still run under this repo's
    // Jest, and its vendored aggregation math is proven against the
    // original lib by src/lib/felt-aggregation/__tests__/vendored-sync.test.ts.
    ignores: ["dist/*", "node_modules/*", ".expo/*", "supabase/functions/**"],
  },
]);
