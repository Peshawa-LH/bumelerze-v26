module.exports = {
  preset: "jest-expo",
  // "/worktrees/" keeps machine-local git worktrees out of test discovery,
  // so a bare `npm test` never picks up files from a parallel checkout and
  // reports failures that have nothing to do with this working tree.
  testPathIgnorePatterns: ["/node_modules/", "/.expo/", "/dist/", "/worktrees/"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  // `transform`/`moduleNameMapper` merge with the preset's own (Jest docs,
  // "Using preset") rather than replacing it — this only adds a CSS stub on
  // top of jest-expo's existing vector-icons mapping.
  moduleNameMapper: {
    "\\.css$": "<rootDir>/jest.css-mock.js",
    // The Deno edge functions import zod with Deno's `npm:` specifier
    // (`npm:zod@3.25.76`); the app depends on the same zod, so the channel
    // adapters in supabase/functions/ingest-events can be exercised under
    // Jest with a fake `fetch` (their __tests__/adapters.test.ts). Only
    // zod is mapped — supabase-js stays Deno-only, so db.ts and index.ts
    // remain outside the Jest reach by design.
    "^npm:zod@.*$": "zod",
  },
  // react-native-worklets (react-native-reanimated 4's underlying engine)
  // ships its own jest resolver that skips `.native.ts` files when resolving
  // its own internals — without it, Jest's default "prefer .native" platform
  // resolution pulls in the real native-turbomodule bootstrap
  // (`NativeWorklets.native.ts`), which throws immediately outside a real
  // native runtime. Required for the map event sheet's Reanimated-driven
  // drag animation to be importable under Jest at all.
  resolver: "react-native-worklets/jest/resolver.js",
};
