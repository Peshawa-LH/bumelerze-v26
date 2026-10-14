/**
 * The engineering handbook's one entry module for code outside it. The
 * handbook carries about 300 KB of hazard maps; on the web they are one
 * download of their own, fetched when the handbook opens or a home is
 * assessed, never on the first page load. Load it through
 * `loadHandbookArea` (`area-loader.ts`, which on the web is
 * `import("./area")`); do not import it, or the handbook's data modules,
 * statically from anywhere else.
 */
export { HandbookScreen } from "./components/HandbookScreen";
export { siteHazard } from "./site-hazard";
