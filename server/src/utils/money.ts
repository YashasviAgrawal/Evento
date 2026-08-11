/**
 * Money helpers.
 *
 * Every amount that crosses a boundary (database, Razorpay, reports) is an
 * integer number of paise. Rupees only exist for display.
 */

export const PAISE_PER_RUPEE = 100;

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/**
 * Apply a percentage to a paise amount, rounding half-up to the nearest paise.
 * Used for tax, convenience fee and commission so that the parts always sum
 * back to a whole number of paise.
 */
export function percentOf(paise: number, percent: number): number {
  return Math.round((paise * percent) / 100);
}

export function formatINR(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(paiseToRupees(paise));
}

export function clampNonNegative(value: number): number {
  return value < 0 ? 0 : value;
}
