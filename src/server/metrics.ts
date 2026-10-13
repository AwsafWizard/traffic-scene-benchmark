/**
 * Agreement statistics. Pure functions, tested in tests/metrics.test.ts.
 */

/**
 * Fleiss' kappa for items that all have the same number of ratings. Each item is
 * the list of category labels its raters chose. Returns null when it can't be
 * computed (fewer than two items, or every rating identical so chance agreement
 * is 1).
 */
export function fleissKappa(items: string[][]): number | null {
  const valid = items.filter((ratings) => ratings.length >= 2);
  if (valid.length < 2) return null;
  const n = valid[0].length;
  if (valid.some((r) => r.length !== n)) throw new Error("Every item needs the same number of ratings");

  const totals = new Map<string, number>();
  let sumP = 0;
  for (const ratings of valid) {
    const counts = new Map<string, number>();
    for (const r of ratings) counts.set(r, (counts.get(r) ?? 0) + 1);
    let sumSquares = 0;
    for (const [category, c] of counts) {
      sumSquares += c * c;
      totals.set(category, (totals.get(category) ?? 0) + c);
    }
    sumP += (sumSquares - n) / (n * (n - 1));
  }
  const pBar = sumP / valid.length;
  const all = valid.length * n;
  let pe = 0;
  for (const t of totals.values()) pe += (t / all) ** 2;
  if (pe >= 1) return null;
  return (pBar - pe) / (1 - pe);
}

/** Share of pairs within each item that agree, pooled over items. */
export function pairwiseAgreement(items: string[][]): number | null {
  let agree = 0;
  let pairs = 0;
  for (const ratings of items) {
    for (let i = 0; i < ratings.length; i++) {
      for (let j = i + 1; j < ratings.length; j++) {
        pairs++;
        if (ratings[i] === ratings[j]) agree++;
      }
    }
  }
  return pairs === 0 ? null : agree / pairs;
}

export function rate(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}
