module.exports = {
  preset: "jest-expo",
  testPathIgnorePatterns: ["/node_modules/", "/.expo/", "/dist/"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  // `transform`/`moduleNameMapper` merge with the preset's own (Jest docs,
  // "Using preset") rather than replacing it — this only adds a CSS stub on
  // top of jest-expo's existing vector-icons mapping.
  moduleNameMapper: {
    "\\.css$": "<rootDir>/jest.css-mock.js",
  },
};
