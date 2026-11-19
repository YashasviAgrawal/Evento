import { describe, expect, it } from 'vitest';
import { priceBill, offerIneligibility, discountFor, type BillPricing, type EngineOffer, type PriceBillInput } from './engine';
import { toLocalMoment } from '../time';
import { codeAt, newVerifySecret } from '../bills/verification';

// Thursday 19 Nov 2026, 20:00 IST
const THU_8PM = toLocalMoment(new Date('2026-11-19T14:30:00Z'));

function offer(overrides: Partial<EngineOffer> = {}): EngineOffer {
  return {
    id: 'o-1',
    owner: 'restaurant',
    code: null,
    title: '20% off the bill',
    kind: 'percent',
    percentOff: 20,
    flatOffPaise: null,
    maxDiscountPaise: null,
    minBillPaise: 0,
    appliesTo: 'both',
    days: [0, 1, 2, 3, 4, 5, 6],
    startTime: '00:00:00',
    endTime: '23:59:59',
    validFrom: null,
    validUntil: null,
    perUserLimit: null,
    restaurantFundedPct: 100,
    ...overrides,
  };
}

function input(overrides: Partial<PriceBillInput> = {}): PriceBillInput {
  return {
    billTotalPaise: 200_000,
    nonDiscountablePaise: 0,
    keepServiceCharge: false,
    serviceChargePercent: 0,
    tipPaise: 0,
    mode: 'walkin',
    at: THU_8PM,
    restaurantOffers: [offer()],
    convenienceFeePaise: 1000,
    commissionBps: 800,
    ...overrides,
  };
}

/**
 * Money in = money out: what the diner pays, plus every rupee someone else
 * funded (platform promos, bank offers, the deposit, the wallet), equals what
 * the restaurant is paid plus what the platform keeps.
 */
function expectBalanced(result: BillPricing) {
  const platformTake = result.convenienceFeePaise + result.commissionPaise + result.commissionGstPaise;
  const fundedElsewhere =
    result.platformFundedDiscountPaise + result.bankFundedDiscountPaise + result.coverCreditPaise + result.walletUsedPaise;
  expect(result.amountPayablePaise + fundedElsewhere).toBe(result.restaurantPayoutPaise + platformTake);
}

describe('dining pricing engine', () => {
  it('prices the ₹2,000 / 20% / 8% example from the plan', () => {
    const result = priceBill(input());
    expect(result.restaurantOffer?.discountPaise).toBe(40_000);
    expect(result.commissionBasePaise).toBe(160_000);
    expect(result.commissionPaise).toBe(12_800);
    expect(result.commissionGstPaise).toBe(2304);
    expect(result.amountPayablePaise).toBe(161_000);
    expect(result.restaurantPayoutPaise).toBe(160_000 - 12_800 - 2304);
  });

  it('balances: what the diner pays = restaurant payout + platform take − platform-funded discount', () => {
    const result = priceBill(
      input({
        tipPaise: 5000,
        keepServiceCharge: true,
        serviceChargePercent: 5,
        coupon: offer({ id: 'c', owner: 'platform', code: 'TIXIT', kind: 'flat', percentOff: null, flatOffPaise: 10_000, restaurantFundedPct: 0 }),
      }),
    );
    expectBalanced(result);
  });

  it('never discounts items marked not-on-offer, service charge or tip', () => {
    const result = priceBill(
      input({ nonDiscountablePaise: 50_000, keepServiceCharge: true, serviceChargePercent: 10, tipPaise: 10_000 }),
    );
    expect(result.discountablePaise).toBe(150_000);
    expect(result.restaurantOffer?.discountPaise).toBe(30_000);
    expect(result.serviceChargePaise).toBe(20_000);
    expect(result.amountPayablePaise).toBe(200_000 - 30_000 + 20_000 + 10_000 + 1000);
  });

  it('adds no service charge unless the diner opts in', () => {
    const result = priceBill(input({ serviceChargePercent: 10 }));
    expect(result.serviceChargePaise).toBe(0);
    expect(result.lines.find((line) => line.key === 'service_charge')).toBeUndefined();
  });

  it('picks the best eligible restaurant offer, deterministically', () => {
    const result = priceBill(
      input({
        restaurantOffers: [
          offer({ id: 'a', percentOff: 10 }),
          offer({ id: 'b', kind: 'flat', percentOff: null, flatOffPaise: 50_000 }),
          offer({ id: 'c', percentOff: 30, appliesTo: 'prebook' }),
        ],
      }),
    );
    expect(result.restaurantOffer?.id).toBe('b');
  });

  it('respects day and time windows, and honours a promised pre-book offer outside them', () => {
    const lunchOnly = offer({ id: 'lunch', startTime: '12:00:00', endTime: '15:00:00' });
    expect(priceBill(input({ restaurantOffers: [lunchOnly] })).restaurantOffer).toBeNull();
    const promised = priceBill(input({ mode: 'prebook', restaurantOffers: [], promisedOffer: lunchOnly }));
    expect(promised.restaurantOffer?.id).toBe('lunch');
  });

  it('caps discounts and enforces minimum bill', () => {
    expect(discountFor(offer({ maxDiscountPaise: 25_000 }), 200_000)).toBe(25_000);
    expect(offerIneligibility(offer({ minBillPaise: 300_000 }), { mode: 'walkin', at: THU_8PM, billTotalPaise: 200_000 })).toMatch(/₹3,000/);
  });

  it('stacks a coupon on what is left and reports why a coupon fails', () => {
    const ok = priceBill(input({ coupon: offer({ id: 'c', owner: 'platform', code: 'TEN', percentOff: 10, restaurantFundedPct: 0 }) }));
    expect(ok.coupon?.discountPaise).toBe(16_000);
    expect(ok.platformFundedDiscountPaise).toBe(16_000);

    const used = priceBill(
      input({ coupon: offer({ id: 'c', owner: 'platform', code: 'TEN', perUserLimit: 1 }), usage: { c: 1 } }),
    );
    expect(used.coupon).toBeNull();
    expect(used.couponError).toMatch(/already used/);
    expect(priceBill(input({ couponCodeNotFound: 'NOPE' })).couponError).toBe('This code is not valid');
  });

  it('splits shared funding and keeps commission on restaurant-funded net sales only', () => {
    const result = priceBill(input({ restaurantOffers: [offer({ restaurantFundedPct: 75 })] }));
    expect(result.restaurantFundedDiscountPaise).toBe(30_000);
    expect(result.platformFundedDiscountPaise).toBe(10_000);
    expect(result.commissionBasePaise).toBe(170_000);
  });

  it('holds its invariants across many random bills', () => {
    for (let i = 0; i < 500; i += 1) {
      const bill = Math.floor(Math.random() * 5_000_000) + 1;
      const result = priceBill(
        input({
          billTotalPaise: bill,
          nonDiscountablePaise: Math.floor(Math.random() * bill),
          tipPaise: Math.floor(Math.random() * 10_000),
          keepServiceCharge: Math.random() > 0.5,
          serviceChargePercent: 5,
          restaurantOffers: [offer({ percentOff: Math.ceil(Math.random() * 50), restaurantFundedPct: Math.floor(Math.random() * 101) })],
          coupon: offer({ id: 'c', owner: 'platform', code: 'X', kind: 'flat', percentOff: null, flatOffPaise: 20_000, restaurantFundedPct: 0 }),
          bankOffer: offer({ id: 'b', owner: 'bank', bankName: 'HDFC', percentOff: 10, maxDiscountPaise: 20_000, restaurantFundedPct: 20 }),
          coverDepositPaise: Math.random() > 0.5 ? Math.floor(Math.random() * 100_000) : 0,
          walletAvailablePaise: Math.floor(Math.random() * 50_000),
          walletMaxPercent: 50,
        }),
      );
      expect(result.walletUsedPaise).toBeLessThanOrEqual(Math.ceil((result.amountPayablePaise - result.convenienceFeePaise + result.walletUsedPaise) / 2));
      expect(result.amountPayablePaise).toBeGreaterThanOrEqual(0);
      expect(result.totalDiscountPaise).toBeLessThanOrEqual(result.discountablePaise);
      const sum = result.lines.reduce((total, line) => total + line.amountPaise, 0);
      expect(sum).toBe(result.amountPayablePaise);
      expectBalanced(result);
    }
  });
});

describe('bank offers, table deposits and the wallet', () => {
  const hdfc = offer({ id: 'hdfc', owner: 'bank', bankName: 'HDFC', title: 'HDFC cards: 10% off', percentOff: 10, maxDiscountPaise: 15_000, restaurantFundedPct: 0 });

  it('stacks a bank offer after the restaurant offer, funded by the bank', () => {
    const result = priceBill(input({ bankOffer: hdfc }));
    // 20% restaurant offer leaves 1,600; 10% of that is 160, capped at 150.
    expect(result.bankOffer?.discountPaise).toBe(15_000);
    expect(result.bankFundedDiscountPaise).toBe(15_000);
    expect(result.lines.find((l) => l.key === 'bank_offer')?.fundedBy).toBe('bank');
    // Bank-funded discounts do not reduce the restaurant's net sales.
    expect(result.commissionBasePaise).toBe(160_000);
    expectBalanced(result);
  });

  it('credits the table deposit against the bill, never beyond it', () => {
    const credited = priceBill(input({ coverDepositPaise: 50_000 }));
    expect(credited.coverCreditPaise).toBe(50_000);
    expect(credited.amountPayablePaise).toBe(160_000 - 50_000 + 1000);
    const tiny = priceBill(input({ billTotalPaise: 30_000, coverDepositPaise: 50_000, restaurantOffers: [] }));
    expect(tiny.coverCreditPaise).toBe(30_000);
    expect(tiny.amountPayablePaise).toBe(1000);
    expectBalanced(credited);
  });

  it('caps the wallet at its share of the bill and never charges the restaurant for it', () => {
    const result = priceBill(input({ walletAvailablePaise: 200_000, walletMaxPercent: 50 }));
    expect(result.walletUsedPaise).toBe(80_000);
    expect(result.restaurantPayoutPaise).toBe(priceBill(input()).restaurantPayoutPaise);
    expect(priceBill(input({ walletAvailablePaise: 5000, walletMaxPercent: 50 })).walletUsedPaise).toBe(5000);
    expectBalanced(result);
  });
});

describe('payment pass verification code', () => {
  it('is 6 digits, stable within a step and different across steps', () => {
    const secret = newVerifySecret();
    const a = codeAt(secret, new Date('2026-11-19T14:30:01Z'));
    const b = codeAt(secret, new Date('2026-11-19T14:30:29Z'));
    const c = codeAt(secret, new Date('2026-11-19T14:30:31Z'));
    expect(a.code).toMatch(/^\d{6}$/);
    expect(a.code).toBe(b.code);
    expect(a.code).not.toBe(c.code);
    expect(a.stepEndsAt.toISOString()).toBe('2026-11-19T14:30:30.000Z');
  });

  it('differs between bills', () => {
    const at = new Date();
    expect(codeAt(newVerifySecret(), at).code).not.toBe(codeAt(newVerifySecret(), at).code);
  });
});
