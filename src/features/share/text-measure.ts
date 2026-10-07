/**
 * Text width estimation and wrapping for the share card.
 *
 * SVG has no text-measurement API at this layer and the card is built as pure
 * data, so widths are estimated from per-script average advance widths of
 * Vazirmatn (em fractions, measured on its Latin, digit and Arabic glyphs).
 * The factors lean slightly wide so a line is wrapped or shrunk early rather
 * than running off the card; text is always anchored at its reading-start
 * edge, so an over-estimate only leaves a little spare room on the far side.
 */

/** Bidi control characters carry no width. */
const ZERO_WIDTH = /[​-‏‪-‮⁦-⁩﻿]/g;
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const DIGIT = /[0-9٠-٩۰-۹]/;

const ARABIC_EM = 0.5;
const DIGIT_EM = 0.58;
const LATIN_EM = 0.56;
const SPACE_EM = 0.27;
const BOLD_FACTOR = 1.07;

export type TextWeight = 400 | 700;

export function estimateTextWidth(
  text: string,
  fontSize: number,
  weight: TextWeight,
): number {
  let em = 0;
  for (const character of text.replace(ZERO_WIDTH, "")) {
    if (character === " ") {
      em += SPACE_EM;
    } else if (DIGIT.test(character)) {
      em += DIGIT_EM;
    } else if (ARABIC_SCRIPT.test(character)) {
      em += ARABIC_EM;
    } else {
      em += LATIN_EM;
    }
  }
  return em * fontSize * (weight === 700 ? BOLD_FACTOR : 1);
}

/**
 * Greedy word wrap to `maxWidth`, at most `maxLines` lines. When the text does
 * not fit, the last line ends in an ellipsis. A single word wider than the
 * line is kept whole on its own line (the font-size fit below handles it).
 */
export function wrapText(
  text: string,
  fontSize: number,
  weight: TextWeight,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  let current = "";
  let index = 0;
  for (; index < words.length; index += 1) {
    const word = words[index]!;
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current === "" || estimateTextWidth(candidate, fontSize, weight) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (lines.length === maxLines - 1) {
      break;
    }
    lines.push(current);
    current = word;
  }
  if (index < words.length) {
    // Out of lines with words left over: fold them into the last line, then
    // trim until the ellipsis fits.
    let last = [current, ...words.slice(index)].join(" ");
    while (
      last.length > 1 &&
      estimateTextWidth(`${last}…`, fontSize, weight) > maxWidth
    ) {
      last = last.slice(0, -1).trimEnd();
    }
    lines.push(`${last}…`);
  } else if (current !== "") {
    lines.push(current);
  }
  return lines;
}

/** The largest size, down to `minSize`, at which `text` fits `maxWidth`. */
export function fitFontSize(
  text: string,
  size: number,
  weight: TextWeight,
  maxWidth: number,
  minSize: number,
): number {
  const width = estimateTextWidth(text, size, weight);
  if (width <= maxWidth) {
    return size;
  }
  return Math.max(minSize, Math.floor((size * maxWidth) / width));
}

/**
 * Word wrap with the line width narrowed as far as it can go without adding a
 * line, so a two-line sentence breaks near its middle instead of leaving one
 * orphan word on the second line.
 */
export function wrapTextBalanced(
  text: string,
  fontSize: number,
  weight: TextWeight,
  maxWidth: number,
  maxLines: number,
): string[] {
  const greedy = wrapText(text, fontSize, weight, maxWidth, maxLines);
  if (greedy.length < 2 || greedy.some((line) => line.endsWith("…"))) {
    return greedy;
  }
  let best = greedy;
  for (let width = maxWidth * 0.96; width > maxWidth * 0.4; width *= 0.96) {
    const lines = wrapText(text, fontSize, weight, width, maxLines);
    if (lines.length !== greedy.length || lines.some((line) => line.endsWith("…"))) {
      break;
    }
    best = lines;
  }
  return best;
}
