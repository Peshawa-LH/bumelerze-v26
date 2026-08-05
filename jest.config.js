module.exports = {
  preset: "jest-expo",
  testPathIgnorePatterns: ["/node_modules/", "/.expo/", "/dist/"],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
