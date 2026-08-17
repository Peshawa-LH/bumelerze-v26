module.exports = {
  preset: "jest-expo",
  // "/.claude/" excludes machine-local agent worktrees (e.g.
  // .claude/worktrees/) from test discovery -- without this, a bare
  // `npm test` can pick up an unrelated in-progress agent's test files and
  // report failures that have nothing to do with this working tree.
  testPathIgnorePatterns: ["/node_modules/", "/.expo/", "/dist/", "/.claude/"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  // `transform`/`moduleNameMapper` merge with the preset's own (Jest docs,
  // "Using preset") rather than replacing it — this only adds a CSS stub on
  // top of jest-expo's existing vector-icons mapping.
  moduleNameMapper: {
    "\\.css$": "<rootDir>/jest.css-mock.js",
  },
};
