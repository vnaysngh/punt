/**
 * Format a CBTC amount for display — strips trailing zeros, preserves all
 * significant digits up to 8 decimal places.
 *
 * Examples:
 *   0.006000   → "0.006"
 *   0.00150000 → "0.0015"
 *   1.00000000 → "1"
 *   1.23456789 → "1.23456789"
 *   0.00000100 → "0.000001"
 */
export function fmt(amount: number): string {
  return parseFloat(amount.toFixed(8)).toString();
}

/**
 * Format with an explicit sign prefix for PnL display.
 * 0.006 → "+0.006", -0.001 → "-0.001"
 */
export function fmtSigned(amount: number): string {
  const s = fmt(Math.abs(amount));
  return amount >= 0 ? `+${s}` : `-${s}`;
}

/**
 * Format a percentage, stripping unnecessary decimals.
 * 50.000 → "50", 33.333 → "33.33"
 */
export function fmtPct(pct: number, decimals = 1): string {
  return parseFloat(pct.toFixed(decimals)).toString();
}
