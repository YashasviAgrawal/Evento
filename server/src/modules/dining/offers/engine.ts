/**
 * The dine-in bill pricing engine.
 *
 * One pure function — no I/O, no clock — called by the quote endpoint *and*
 * inside the payment transaction, so a quote can never disagree with a charge
 * (the same rule `bookings/pricing.ts` follows for event tickets).
 *
 * Order of application, each step working on what the previous one left:
 *
 *   1. discountable base   = bill − items not on offer  (service charge is never in the bill)
 *   2. restaurant offer    best eligible one, by rupees saved
 *   3. platform coupon     at most one, on what is still discountable
 *   4. bank offer          at most one, chosen at checkout, on what is still discountable
 *   5. + optional service charge (opt-in, never discounted, no commission)
 *   6. + tip                (passes to the restaurant in full)
 *   7. − table deposit      cover charge paid at booking, credited here
 *   8. − Tixit Wallet       capped at a share of what is left
 *   9. + platform fee       (flat, GST inclusive; waived for Tixit Pass members)
 *
 * Every line carries who funds it, which is what the diner's receipt shows and
 * what the ledger posts. Amounts are integer paise and every step rounds
 * half-up, so the parts always reconstruct the whole.
 */
import { timeToMinutes, type LocalMoment } from '../time';

export const ENGINE_VERSION = '2.1.0';
const GST_PERCENT = 18;

export type OfferMode = 'prebook' | 'walkin';
export type FundedBy = 'restaurant' | 'platform' | 'bank' | 'shared';

export interface EngineOffer {
  id: string;
  owner: 'restaurant' | 'platform' | 'bank' | 'membership';
  code: string | null;
  title: string;
  kind: 'percent' | 'flat';
  percentOff: number | null;
  flatOffPaise: number | null;
  maxDiscountPaise: number | null;
  minBillPaise: number;
  appliesTo: 'prebook' | 'walkin' | 'both';
  days: number[];
  startTime: string;
  endTime: string;
  validFrom: Date | null;
  validUntil: Date | null;
  perUserLimit: number | null;
  restaurantFundedPct: number;
  /** Bank offers only: the bank funding the non-restaurant share. */
  bankName?: string | null;
}

export interface PriceBillInput {
  billTotalPaise: number;
  nonDiscountablePaise: number;
  keepServiceCharge: boolean;
  serviceChargePercent: number;
  tipPaise: number;
  mode: OfferMode;
  at: LocalMoment;
  restaurantOffers: EngineOffer[];
  /**
   * The pre-book offer promised when a table was reserved. It is honoured
   * whatever the time now — a diner who booked the 7:30 "30% off" slot keeps
   * it even if dinner runs past the offer window.
   */
  promisedOffer?: EngineOffer | null;
  coupon?: EngineOffer | null;
  /** Code the diner typed but that matched nothing, to report back. */
  couponCodeNotFound?: string | null;
  /** The bank offer the diner chose to pay with, if any. */
  bankOffer?: EngineOffer | null;
  /** Prior redemptions by this diner, keyed by offer id. */
  usage?: Record<string, number>;
  /** Cover charge paid at booking and not yet credited. */
  coverDepositPaise?: number;
  /** Wallet balance the diner chose to use (0 to not use it). */
  walletAvailablePaise?: number;
  /** At most this % of the bill after discounts and deposit can come from the wallet. */
  walletMaxPercent?: number;
  convenienceFeePaise: number;
  /** A Tixit Pass member pays no platform fee. */
  feeWaived?: boolean;
  commissionBps: number;
}

export interface PricingLine {
  key: string;
  label: string;
  /** Signed: discounts are negative. */
  amountPaise: number;
  fundedBy?: FundedBy;
  note?: string;
}

export interface AppliedOffer {
  id: string;
  title: string;
  code: string | null;
  discountPaise: number;
  restaurantSharePaise: number;
  platformSharePaise: number;
  bankSharePaise: number;
  bankName?: string | null;
}

export interface BillPricing {
  engineVersion: string;
  billTotalPaise: number;
  nonDiscountablePaise: number;
  discountablePaise: number;
  restaurantOffer: AppliedOffer | null;
  coupon: AppliedOffer | null;
  couponError: string | null;
  bankOffer: AppliedOffer | null;
  bankOfferError: string | null;
  serviceChargePaise: number;
  tipPaise: number;
  coverCreditPaise: number;
  walletUsedPaise: number;
  convenienceFeePaise: number;
  convenienceFeeGstPaise: number;
  /** The fee a Tixit Pass member did not pay — what the pass saved on this bill. */
  feeWaivedPaise: number;
  totalDiscountPaise: number;
  restaurantFundedDiscountPaise: number;
  platformFundedDiscountPaise: number;
  bankFundedDiscountPaise: number;
  amountPayablePaise: number;
  commissionBasePaise: number;
  commissionPaise: number;
  commissionGstPaise: number;
  restaurantPayoutPaise: number;
  lines: PricingLine[];
}

/* ───────────────────────── helpers ───────────────────────── */

function pct(paise: number, percent: number): number {
  return Math.round((paise * percent) / 100);
}

/** Why an offer cannot be used right now, or null when it can. */
export function offerIneligibility(
  offer: EngineOffer,
  context: { mode: OfferMode; at: LocalMoment; billTotalPaise: number; usage?: Record<string, number>; ignoreSchedule?: boolean },
): string | null {
  if (offer.appliesTo !== 'both' && offer.appliesTo !== context.mode) {
    return offer.appliesTo === 'prebook' ? 'Valid only on pre-booked tables' : 'Valid only for walk-ins';
  }
  const now = context.at.instant.getTime();
  if (offer.validFrom && offer.validFrom.getTime() > now) return 'This offer has not started yet';
  if (offer.validUntil && offer.validUntil.getTime() < now) return 'This offer has expired';

  if (!context.ignoreSchedule) {
    if (!offer.days.includes(context.at.weekday)) return 'Not valid today';
    const minutes = context.at.minutes;
    if (minutes < timeToMinutes(offer.startTime) || minutes > timeToMinutes(offer.endTime)) {
      return 'Not valid at this time';
    }
  }

  if (context.billTotalPaise < offer.minBillPaise) {
    return `Valid on bills of ₹${Math.ceil(offer.minBillPaise / 100).toLocaleString('en-IN')} or more`;
  }
  const used = context.usage?.[offer.id] ?? 0;
  if (offer.perUserLimit !== null && used >= offer.perUserLimit) return 'You have already used this offer';
  return null;
}

/** Rupees saved by applying `offer` to `basePaise` — never more than the base. */
export function discountFor(offer: EngineOffer, basePaise: number): number {
  if (basePaise <= 0) return 0;
  let discount =
    offer.kind === 'percent' ? pct(basePaise, Number(offer.percentOff ?? 0)) : Number(offer.flatOffPaise ?? 0);
  if (offer.maxDiscountPaise !== null) discount = Math.min(discount, offer.maxDiscountPaise);
  return Math.max(0, Math.min(discount, basePaise));
}

/** Split a discount between the restaurant and whoever funds the rest. */
function apply(offer: EngineOffer, discountPaise: number): AppliedOffer {
  const restaurantShare = pct(discountPaise, offer.restaurantFundedPct);
  const rest = discountPaise - restaurantShare;
  const bank = offer.owner === 'bank';
  return {
    id: offer.id,
    title: offer.title,
    code: offer.code,
    discountPaise,
    restaurantSharePaise: restaurantShare,
    platformSharePaise: bank ? 0 : rest,
    bankSharePaise: bank ? rest : 0,
    bankName: bank ? (offer.bankName ?? null) : undefined,
  };
}

function fundedBy(applied: AppliedOffer): FundedBy {
  const funders = [
    applied.restaurantSharePaise > 0 && 'restaurant',
    applied.platformSharePaise > 0 && 'platform',
    applied.bankSharePaise > 0 && 'bank',
  ].filter(Boolean) as FundedBy[];
  return funders.length === 1 ? funders[0]! : funders.length === 0 ? 'restaurant' : 'shared';
}

/* ───────────────────────── engine ───────────────────────── */

export function priceBill(input: PriceBillInput): BillPricing {
  const bill = Math.max(0, Math.round(input.billTotalPaise));
  const nonDiscountable = Math.min(Math.max(0, Math.round(input.nonDiscountablePaise)), bill);
  const discountable = bill - nonDiscountable;

  const context = { mode: input.mode, at: input.at, billTotalPaise: bill, usage: input.usage };

  // 2. Restaurant offer: the promised one if still usable, else the best now.
  let restaurantOffer: AppliedOffer | null = null;
  const candidates: Array<{ offer: EngineOffer; discount: number }> = [];
  if (input.promisedOffer && !offerIneligibility(input.promisedOffer, { ...context, ignoreSchedule: true })) {
    candidates.push({ offer: input.promisedOffer, discount: discountFor(input.promisedOffer, discountable) });
  }
  for (const offer of input.restaurantOffers) {
    if (offer.owner !== 'restaurant' || offer.code) continue;
    if (offerIneligibility(offer, context)) continue;
    candidates.push({ offer, discount: discountFor(offer, discountable) });
  }
  // Highest saving wins; ties break on id so the result is deterministic.
  candidates.sort((a, b) => b.discount - a.discount || a.offer.id.localeCompare(b.offer.id));
  const best = candidates[0];
  if (best && best.discount > 0) restaurantOffer = apply(best.offer, best.discount);

  // 3. Coupon, on what is still discountable.
  let remaining = discountable - (restaurantOffer?.discountPaise ?? 0);
  let coupon: AppliedOffer | null = null;
  let couponError: string | null = input.couponCodeNotFound ? 'This code is not valid' : null;
  if (input.coupon) {
    const reason = offerIneligibility(input.coupon, context);
    if (reason) {
      couponError = reason;
    } else {
      const discount = discountFor(input.coupon, remaining);
      if (discount > 0) coupon = apply(input.coupon, discount);
      else couponError = 'Nothing left on this bill for the code to discount';
    }
  }
  remaining -= coupon?.discountPaise ?? 0;

  // 4. Bank offer, chosen by the diner for the instrument they pay with.
  let bankOffer: AppliedOffer | null = null;
  let bankOfferError: string | null = null;
  if (input.bankOffer) {
    const reason = offerIneligibility(input.bankOffer, context);
    if (reason) bankOfferError = reason;
    else {
      const discount = discountFor(input.bankOffer, remaining);
      if (discount > 0) bankOffer = apply(input.bankOffer, discount);
      else bankOfferError = 'Nothing left on this bill for the bank offer to discount';
    }
  }

  const applied = [restaurantOffer, coupon, bankOffer].filter((offer): offer is AppliedOffer => Boolean(offer));
  const restaurantFunded = applied.reduce((sum, offer) => sum + offer.restaurantSharePaise, 0);
  const platformFunded = applied.reduce((sum, offer) => sum + offer.platformSharePaise, 0);
  const bankFunded = applied.reduce((sum, offer) => sum + offer.bankSharePaise, 0);
  const totalDiscount = restaurantFunded + platformFunded + bankFunded;

  // 5–6. Additions.
  const serviceCharge = input.keepServiceCharge ? pct(bill, input.serviceChargePercent) : 0;
  const tip = Math.max(0, Math.round(input.tipPaise));
  let due = bill - totalDiscount + serviceCharge + tip;

  // 7. Table deposit already paid at booking.
  const coverCredit = Math.min(Math.max(0, Math.round(input.coverDepositPaise ?? 0)), due);
  due -= coverCredit;

  // 8. Wallet, never the whole bill.
  const walletCap = pct(due, Math.min(100, Math.max(0, input.walletMaxPercent ?? 0)));
  const walletUsed = Math.min(Math.max(0, Math.round(input.walletAvailablePaise ?? 0)), walletCap);
  due -= walletUsed;

  // 9. Platform fee.
  const standardFee = bill > 0 ? Math.max(0, Math.round(input.convenienceFeePaise)) : 0;
  const feeWaived = input.feeWaived ? standardFee : 0;
  const fee = standardFee - feeWaived;
  const feeGst = Math.round((fee * GST_PERCENT) / (100 + GST_PERCENT));
  const payable = due + fee;

  // Commission is a share of net sales: the bill after what the restaurant
  // itself gave away. Service charge and tip are the staff's, not sales. The
  // deposit and wallet change who pays, not what the restaurant earns.
  const commissionBase = bill - restaurantFunded;
  const commission = Math.round((commissionBase * input.commissionBps) / 10_000);
  const commissionGst = pct(commission, GST_PERCENT);
  const restaurantPayout = bill - restaurantFunded + serviceCharge + tip - commission - commissionGst;

  const lines: PricingLine[] = [{ key: 'bill', label: 'Bill total', amountPaise: bill }];
  if (nonDiscountable > 0) {
    lines.push({
      key: 'non_discountable',
      label: 'Not on offer',
      amountPaise: 0,
      note: `₹${(nonDiscountable / 100).toLocaleString('en-IN')} of your bill is excluded from discounts`,
    });
  }
  if (restaurantOffer) {
    lines.push({ key: 'restaurant_offer', label: restaurantOffer.title, amountPaise: -restaurantOffer.discountPaise, fundedBy: fundedBy(restaurantOffer) });
  }
  if (coupon) {
    lines.push({ key: 'coupon', label: coupon.code ? `${coupon.code} applied` : coupon.title, amountPaise: -coupon.discountPaise, fundedBy: fundedBy(coupon) });
  }
  if (bankOffer) {
    lines.push({ key: 'bank_offer', label: bankOffer.title, amountPaise: -bankOffer.discountPaise, fundedBy: fundedBy(bankOffer) });
  }
  if (serviceCharge > 0) {
    lines.push({ key: 'service_charge', label: `Service charge (${input.serviceChargePercent}%)`, amountPaise: serviceCharge, note: 'Optional · you chose to add it' });
  }
  if (tip > 0) lines.push({ key: 'tip', label: 'Tip for the staff', amountPaise: tip });
  if (coverCredit > 0) lines.push({ key: 'cover_credit', label: 'Table deposit paid at booking', amountPaise: -coverCredit });
  if (walletUsed > 0) lines.push({ key: 'wallet', label: 'Tixit Wallet', amountPaise: -walletUsed });
  if (fee > 0) lines.push({ key: 'fee', label: 'Platform fee (incl. GST)', amountPaise: fee });
  if (feeWaived > 0) {
    lines.push({ key: 'fee_waived', label: 'Platform fee', amountPaise: 0, note: `₹${feeWaived / 100} waived with Tixit Pass` });
  }

  return {
    engineVersion: ENGINE_VERSION,
    billTotalPaise: bill,
    nonDiscountablePaise: nonDiscountable,
    discountablePaise: discountable,
    restaurantOffer,
    coupon,
    couponError,
    bankOffer,
    bankOfferError,
    serviceChargePaise: serviceCharge,
    tipPaise: tip,
    coverCreditPaise: coverCredit,
    walletUsedPaise: walletUsed,
    convenienceFeePaise: fee,
    convenienceFeeGstPaise: feeGst,
    feeWaivedPaise: feeWaived,
    totalDiscountPaise: totalDiscount,
    restaurantFundedDiscountPaise: restaurantFunded,
    platformFundedDiscountPaise: platformFunded,
    bankFundedDiscountPaise: bankFunded,
    amountPayablePaise: payable,
    commissionBasePaise: commissionBase,
    commissionPaise: commission,
    commissionGstPaise: commissionGst,
    restaurantPayoutPaise: restaurantPayout,
    lines,
  };
}
