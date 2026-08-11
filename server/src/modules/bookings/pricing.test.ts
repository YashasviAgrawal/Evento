import { describe, expect, it } from 'vitest';
import { calculatePricing, type PriceLine } from './pricing';
import { percentOf, rupeesToPaise, paiseToRupees } from '../../utils/money';

const RATES = { taxPercent: 18, convenienceFeePercent: 2, commissionPercent: 10 };

function line(unitRupees: number, quantity: number, name = 'Regular'): PriceLine {
  const unitPricePaise = rupeesToPaise(unitRupees);
  return {
    ticketTypeId: `tt-${name}`,
    name,
    unitPricePaise,
    quantity,
    subtotalPaise: unitPricePaise * quantity,
  };
}

describe('money helpers', () => {
  it('converts rupees to integer paise without float drift', () => {
    // 0.1 + 0.2 style errors are exactly what integer paise exists to prevent.
    expect(rupeesToPaise(1499.99)).toBe(149999);
    expect(rupeesToPaise(0.1)).toBe(10);
    expect(rupeesToPaise(1234.565)).toBe(123457);
    expect(paiseToRupees(149999)).toBeCloseTo(1499.99, 2);
  });

  it('rounds percentages half-up to whole paise', () => {
    expect(percentOf(100, 18)).toBe(18);
    expect(percentOf(53820, 18)).toBe(9688); // 9687.6 → 9688
    expect(percentOf(1, 50)).toBe(1); // 0.5 → 1
  });
});

describe('calculatePricing', () => {
  it('computes a simple order end to end', () => {
    const result = calculatePricing([line(1000, 2)], 0, RATES);

    expect(result.subtotalPaise).toBe(200_000);
    expect(result.quantity).toBe(2);
    expect(result.taxPaise).toBe(36_000); // 18% of 200000
    expect(result.convenienceFeePaise).toBe(4_000); // 2% of 200000
    expect(result.totalPaise).toBe(240_000);
    expect(result.commissionPaise).toBe(20_000); // 10% of 200000
    expect(result.organizerPayoutPaise).toBe(180_000);
  });

  it('applies tax and fees to the post-discount base, not the gross subtotal', () => {
    const discount = 20_000; // ₹200 off a ₹1,000 order
    const result = calculatePricing([line(1000, 1)], discount, RATES);

    expect(result.taxablePaise).toBe(80_000);
    expect(result.taxPaise).toBe(percentOf(80_000, 18));
    expect(result.convenienceFeePaise).toBe(percentOf(80_000, 2));
    expect(result.totalPaise).toBe(80_000 + result.taxPaise + result.convenienceFeePaise);
  });

  it('takes commission out of the organizer share, never off the top of tax', () => {
    const result = calculatePricing([line(1000, 1)], 0, RATES);

    // Commission + payout must reconstruct the taxable base exactly.
    expect(result.commissionPaise + result.organizerPayoutPaise).toBe(result.taxablePaise);
  });

  it('never lets a discount exceed the order value', () => {
    const result = calculatePricing([line(500, 1)], 999_999, RATES);

    expect(result.discountPaise).toBe(50_000);
    expect(result.taxablePaise).toBe(0);
    expect(result.totalPaise).toBe(0);
    expect(result.organizerPayoutPaise).toBe(0);
  });

  it('sums multiple ticket tiers', () => {
    const result = calculatePricing([line(1500, 2, 'Regular'), line(6999, 1, 'VIP')], 0, RATES);

    expect(result.quantity).toBe(3);
    expect(result.subtotalPaise).toBe(rupeesToPaise(1500) * 2 + rupeesToPaise(6999));
  });

  it('keeps every component a whole number of paise', () => {
    // A price that divides awkwardly by the percentages.
    const result = calculatePricing([line(333.33, 3)], 4_567, RATES);

    for (const value of [
      result.subtotalPaise,
      result.discountPaise,
      result.taxPaise,
      result.convenienceFeePaise,
      result.totalPaise,
      result.commissionPaise,
      result.organizerPayoutPaise,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('produces a zero total for a free event', () => {
    const result = calculatePricing([line(0, 4)], 0, RATES);

    expect(result.totalPaise).toBe(0);
    expect(result.taxPaise).toBe(0);
    expect(result.commissionPaise).toBe(0);
  });
});
