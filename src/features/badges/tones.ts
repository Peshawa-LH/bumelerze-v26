import type { SemanticColors } from "@/theme";

import type { BadgeTone } from "./catalog";

/** Theme token that carries each badge tone. */
export function toneColor(tone: BadgeTone, colors: SemanticColors): string {
  switch (tone) {
    case "info":
      return colors.status.info;
    case "success":
      return colors.status.success;
    case "brand":
      return colors.brand.primary;
    case "link":
      return colors.text.link;
    case "warning":
      return colors.status.warning;
  }
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function toHex(channels: readonly number[]): string {
  return `#${channels
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** The colour as `rgba(...)`, for a translucent tint. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** What `withAlpha(fg, alpha)` looks like once drawn over an opaque `bg`. */
export function blendOver(fg: string, alpha: number, bg: string): string {
  const front = parseHex(fg);
  const back = parseHex(bg);
  return toHex(front.map((channel, i) => channel * alpha + (back[i] ?? 0) * (1 - alpha)));
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque hex colours. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

/** Fill of an earned badge: the tone at 16% over the card. */
export const EARNED_TINT_ALPHA = 0.16;

/** Graphics (glyph, ring) must reach 3:1 against what is behind them. */
export const GRAPHIC_MIN_CONTRAST = 3;

function mix(from: string, toChannels: readonly number[], amount: number): string {
  const channels = parseHex(from);
  return toHex(channels.map((c, i) => c + ((toChannels[i] ?? 0) - c) * amount));
}

/**
 * The tone nudged toward black (light theme) or white (dark theme), only as
 * far as needed, until it is at least 3:1 against both its own tint and the
 * card. Several status colours are tuned for text on a plain surface and
 * fall just under 3:1 on their own 16% tint; this keeps the hue and the
 * theme tokens untouched and fixes only the badge glyph.
 */
export function accessibleAccent(
  tone: BadgeTone,
  colors: SemanticColors,
  scheme: "light" | "dark",
): string {
  const base = toneColor(tone, colors);
  const card = colors.surface.raised;
  const tint = blendOver(base, EARNED_TINT_ALPHA, card);
  const toward = scheme === "light" ? [0, 0, 0] : [255, 255, 255];
  for (let step = 0; step <= 20; step += 1) {
    const candidate = step === 0 ? base : mix(base, toward, step * 0.05);
    if (
      contrastRatio(candidate, tint) >= GRAPHIC_MIN_CONTRAST &&
      contrastRatio(candidate, card) >= GRAPHIC_MIN_CONTRAST
    ) {
      return candidate;
    }
  }
  return mix(base, toward, 1);
}

export interface BadgePalette {
  /** Circle fill. */
  fill: string;
  /** Ring colour (earned only). */
  ring: string | null;
  /** Glyph colour. */
  glyph: string;
}

/** Colours of one badge circle, earned or locked, on the card surface. */
export function badgePalette(
  tone: BadgeTone,
  earned: boolean,
  colors: SemanticColors,
  scheme: "light" | "dark",
): BadgePalette {
  if (!earned) {
    return { fill: colors.surface.sunken, ring: null, glyph: colors.text.tertiary };
  }
  const accent = accessibleAccent(tone, colors, scheme);
  return {
    fill: withAlpha(toneColor(tone, colors), EARNED_TINT_ALPHA),
    ring: accent,
    glyph: accent,
  };
}
