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
 *   tax and convenience fee are charged on the taxable base (post-discount),
 *   which is what Indian GST rules require for a discounted sale.
 *   Commission is the platform's cut of net ticket revenue and is excluded
 *   from tax/fee, since those are not the organizer's earnings.
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

  const taxPaise = percentOf(taxablePaise, rates.taxPercent);
  const convenienceFeePaise = percentOf(taxablePaise, rates.convenienceFeePercent);
  const totalPaise = taxablePaise + taxPaise + convenienceFeePaise;

  const commissionPaise = percentOf(taxablePaise, rates.commissionPercent);
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
