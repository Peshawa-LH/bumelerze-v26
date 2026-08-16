// Jest stub for CSS side-effect imports (e.g. `maplibre-gl/dist/maplibre-gl.css`
// in `app/(tabs)/map.web.tsx`) — Jest's transformer can't parse raw CSS as
// JS, and this app has no real stylesheet-loading concern under test (no
// jsdom layout is asserted against). Mapped via jest.config.js's
// `moduleNameMapper`.
module.exports = {};
