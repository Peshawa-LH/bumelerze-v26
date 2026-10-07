/**
 * Test helpers for the intensity-numeral guard (owner note N15): Sorani and
 * Arabic must show digits, never Roman numerals, wherever an intensity is
 * printed.
 */

/** A standalone Roman numeral I..XII (not part of a longer Latin word). */
export const ROMAN_NUMERAL =
  /(?<![A-Za-z])(?:XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)(?![A-Za-z])/;

/** Every text string in a rendered tree (react-test-renderer JSON). */
export function collectText(node: unknown): string[] {
  if (node === null || node === undefined) {
    return [];
  }
  if (typeof node === "string") {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectText);
  }
  if (typeof node === "object") {
    const children = (node as { children?: unknown }).children;
    return collectText(children);
  }
  return [];
}

/** Accessibility labels in a rendered tree, since a label can carry the
 * level too. */
export function collectLabels(node: unknown): string[] {
  if (node === null || node === undefined || typeof node !== "object") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectLabels);
  }
  const { props, children } = node as {
    props?: { accessibilityLabel?: unknown };
    children?: unknown;
  };
  const own =
    typeof props?.accessibilityLabel === "string" ? [props.accessibilityLabel] : [];
  return [...own, ...collectLabels(children)];
}
