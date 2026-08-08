// Ambient module declaration for binary asset extensions Metro treats as
// bundled assets (see metro.config.js) but that TypeScript has no built-in
// typing for — `require()`ing one returns the numeric asset module id Metro
// generates, same shape as the `.png`/`.ttf` assets React Native's own
// bundler config already knows about. Needed for the regional-catalog
// wave's bundled SQLite database (features/catalog/db.ts,
// `require("@/assets/catalog/bumelerze-catalog.sqlite")`).
declare module "*.sqlite" {
  const assetId: number;
  export default assetId;
}

declare module "*.db" {
  const assetId: number;
  export default assetId;
}
