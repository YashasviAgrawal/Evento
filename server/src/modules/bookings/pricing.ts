import { percentOf } from '../../utils/money';

export interface PriceLine {
  ticketTypeId: string;
  name: string;
  unitPricePaise: number;
  quantity: number;
  subtotalPaise: number;
}

export interface PriceBreakdown {
  lines: PriceLine[];
  quantity: number;
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxPaise: number;
  convenienceFeePaise: number;
  totalPaise: number;
  commissionPercent: number;
  commissionPaise: number;
  organizerPayoutPaise: number;
}

export interface PricingRates {
  taxPercent: number;
  convenienceFeePercent: number;
  commissionPercent: number;
}

/**
 * The single source of truth for order maths.
 *
 * Both the quote endpoint and the booking transaction call this, so the total
 * a customer is shown before paying is computed by exactly the same code that
 * charges them — a quote can never drift from the charge.
 *
 * Order of operations:
 *   subtotal  →  minus coupon discount  →  taxable base
 *   convenience fee is charged on the taxable base (post-discount), and GST
 *   is charged on the convenience fee only, not on the ticket price.
 *
 * Commission is charged on the FULL pre-discount subtotal, not the discounted
 * base. A coupon is the organizer's marketing decision, so the organizer bears
 * its whole cost and platform revenue is unaffected by their promotions.
 */
export function calculatePricing(
  lines: PriceLine[],
  discountPaise: number,
  rates: PricingRates,
): PriceBreakdown {
  const subtotalPaise = lines.reduce((sum, line) => sum + line.subtotalPaise, 0);
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);

  const cappedDiscount = Math.max(0, Math.min(discountPaise, subtotalPaise));
  const taxablePaise = subtotalPaise - cappedDiscount;

  // Rounded to the nearest whole rupee so the customer sees ₹4, not ₹3.75.
  const convenienceFeePaise = Math.round(percentOf(taxablePaise, rates.convenienceFeePercent) / 100) * 100;
  // GST applies to the platform's convenience fee, not the ticket price.
  const taxPaise = percentOf(convenienceFeePaise, rates.taxPercent);
  const totalPaise = taxablePaise + taxPaise + convenienceFeePaise;

  /*
   * Commission is on the full subtotal, but it can never exceed the money
   * actually collected. With steep discounts allowed, a 95%-off coupon on a
   * ₹1,000 ticket collects ₹50 while 10% of the original is ₹100 — charging
   * that would mean an impossible negative payout, which the
   * organizer_payout_paise >= 0 constraint would reject outright.
   *
   * So the platform takes its full cut where the revenue covers it, and at
   * most the whole collected amount where it does not.
   */
  const commissionPaise = Math.min(percentOf(subtotalPaise, rates.commissionPercent), taxablePaise);
  const organizerPayoutPaise = taxablePaise - commissionPaise;

  return {
    lines,
    quantity,
    subtotalPaise,
    discountPaise: cappedDiscount,
    taxablePaise,
    taxPaise,
    convenienceFeePaise,
    totalPaise,
    commissionPercent: rates.commissionPercent,
    commissionPaise,
    organizerPayoutPaise,
  };
}
