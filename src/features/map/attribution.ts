/**
 * MapTiler logo-attribution requirement (update-plan-2026-08.md Part 4):
 * MapTiler's free-tier terms require their logo be shown on the map
 * whenever a MapTiler-served style is active — the existing
 * `AttributionControl` (`map.web.tsx`) already renders the correct TEXT
 * credit line for both providers automatically (each style's vector source
 * carries its own live `attribution` string, MapLibre collects it — see
 * `config.ts`'s doc comment above `MAP_WORKER_URL`), but text alone doesn't
 * satisfy MapTiler's LOGO requirement, and OpenFreeMap carries no such
 * requirement at all (never show this for the OpenFreeMap fallback).
 *
 * The logo asset URL/link target below are NOT invented — both are read
 * directly out of MapTiler's own official `@maptiler/sdk` package (its
 * `Ur`/config object, `maptilerLogoURL`/`maptilerURL` — verified 2026-08-17
 * against the published `dist/maptiler-sdk.umd.min.js` build) and its
 * `LogoControl`'s own `onAdd`, which renders exactly this asset as a linked
 * logo. Using MapTiler's own documented asset/link, not a fabricated one.
 */

/** MapTiler's own logo SVG, served from their API host — same asset their
 * official Maps SDK's `LogoControl` uses (see module doc comment). */
export const MAPTILER_LOGO_URL = "https://api.maptiler.com/resources/logo.svg";

/** Link target the logo points at, matching MapTiler's own `LogoControl`. */
export const MAPTILER_LOGO_LINK_URL = "https://www.maptiler.com/";

/** Rendered size, in px — matches MapTiler's own `LogoControl` exactly
 * (`100px` × `30px`, verified against its `onAdd` implementation) rather
 * than an arbitrary "unobtrusive" shrink: their attribution terms specify
 * the logo be legible, and matching their own reference implementation's
 * size is the safest way to stay compliant while still keeping it a small
 * corner element (not a full toolbar-sized graphic). */
export const MAPTILER_LOGO_WIDTH_PX = 100;
export const MAPTILER_LOGO_HEIGHT_PX = 30;
