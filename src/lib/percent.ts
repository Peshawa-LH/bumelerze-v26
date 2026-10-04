/**
 * Rounds each raw percentage to a whole number, then nudges the LARGEST one
 * so they sum to exactly 100. Independently rounded shares can land on 99 or
 * 101 (33/33/34 raw rounds to 99), and a bar or donut whose parts do not
 * make a whole either leaves a gap or overflows.
 */
export function roundToWhole100(rawPercents: readonly number[]): number[] {
  const rounded = rawPercents.map((value) => Math.round(value));
  const total = rounded.reduce((sum, value) => sum + value, 0);
  const diff = 100 - total;
  if (diff === 0 || rounded.length === 0) {
    return rounded;
  }
  const largestIndex = rounded.indexOf(Math.max(...rounded));
  rounded[largestIndex] = (rounded[largestIndex] ?? 0) + diff;
  return rounded;
}
