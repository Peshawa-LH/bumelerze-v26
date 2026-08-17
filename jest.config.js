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
  },
};
