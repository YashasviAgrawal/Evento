'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarCheck2, Check, ChevronRight, CreditCard, Crown, Delete, Lock, TicketPercent, Users, X } from 'lucide-react';
import { ApiError, api, openCheckout, PAYMENT_CANCELLED, useAuth } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { Bill, BillCheckout, BillQuote, Reservation } from '@/lib/types';
import { cn, localDate, rupees, timeOnly } from '@/lib/format';
import { Stepper, Toggle } from '@/components/ui/controls';
import { Spinner } from '@/components/ui/feedback';
import { Photo } from '@/components/ui/photo';
import { Receipt, SavingsBanner } from './receipt';

export interface PayRestaurant {
  id: string;
  slug: string;
  name: string;
  locality: string;
  logoUrl: string | null;
  coverUrl: string | null;
  serviceChargePercent: number;
  walkinOffer: string | null;
}

type Field = 'bill' | 'excluded';

/** Mirrors the server: up to ten people, at least ₹50 each. */
const MAX_SPLIT = 10;
const MIN_SHARE_PAISE = 5_000;
const MAX_DIGITS = 7;
const TIPS = [0, 50, 100, 200];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Pay Bill, in two calm steps.
 *
 * 1. Amount — a custom keypad, so no OS keyboard ever covers the savings, and
 *    physical keys work on a laptop. Items not on offer and the optional
 *    service charge are explicit, separate controls.
 * 2. Review — the receipt, itemised by who funds each saving, with the exact
 *    amount on the pay button.
 *
 * The draft lives in the URL, so signing in mid-flow returns to the same bill.
 */
export function PayBill({ restaurant }: { restaurant: PayRestaurant }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { user } = useAuth();
  const toast = useToast();

  const [bill, setBill] = useState(params.get('bill') ?? '');
  const [excluded, setExcluded] = useState(params.get('nd') ?? '');
  const [hasExcluded, setHasExcluded] = useState(Boolean(params.get('nd')));
  const [keepService, setKeepService] = useState(params.get('sc') === '1');
  const [tip, setTip] = useState(Number(params.get('tip') ?? 0));
  const [field, setField] = useState<Field>('bill');
  const [step, setStep] = useState<'amount' | 'review'>(params.get('step') === 'review' && params.get('bill') ? 'review' : 'amount');
  const [couponInput, setCouponInput] = useState(params.get('code') ?? '');
  const [coupon, setCoupon] = useState<string | null>(params.get('code'));
  const [couponOpen, setCouponOpen] = useState(Boolean(params.get('code')));
  const [useWallet, setUseWallet] = useState(params.get('wallet') !== '0');
  const [bankOfferId, setBankOfferId] = useState<string | null>(params.get('bank'));
  const [splitInto, setSplitInto] = useState(Math.min(MAX_SPLIT, Math.max(1, Number(params.get('split') ?? 1) || 1)));
  const splitting = splitInto > 1;
  const idempotencyKey = useRef<string>(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()));

  // Today's table here, if any: paying from it applies the pre-book offer that was promised.
  const reservations = useQuery({
    queryKey: ['reservations', user?.id],
    queryFn: async () => (await api.get<Reservation[]>('/dining/reservations')).data,
    enabled: Boolean(user),
  });
  const todaysTable = reservations.data?.find(
    (r) =>
      r.restaurant.id === restaurant.id && r.localDate === localDate() && ['placed', 'confirmed', 'seated'].includes(r.status),
  );

  const billValue = Number(bill || 0);
  const excludedValue = hasExcluded ? Math.min(Number(excluded || 0), billValue) : 0;
  const input = useMemo(
    () => ({
      restaurantId: restaurant.id,
      billTotal: billValue,
      nonDiscountable: excludedValue,
      keepServiceCharge: keepService,
      tip,
      couponCode: coupon,
      reservationCode: todaysTable?.code ?? null,
      useWallet,
      bankOfferId: splitting ? null : bankOfferId,
    }),
    [restaurant.id, billValue, excludedValue, keepService, tip, coupon, todaysTable?.code, useWallet, bankOfferId, splitting],
  );
  const debounced = useDebounced(input, 250);

  const quote = useQuery({
    queryKey: ['bill-quote', debounced],
    queryFn: async () => (await api.post<BillQuote>('/dining/bills/quote', debounced)).data,
    enabled: debounced.billTotal >= 1,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const pricing = billValue >= 1 ? quote.data : undefined;

  // Physical keyboard support for the keypad.
  useEffect(() => {
    if (step !== 'amount') return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === 'INPUT') return;
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') press('del');
      else if (event.key === 'Enter' && billValue >= 1) setStep('review');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function press(key: string) {
    const set = field === 'bill' ? setBill : setExcluded;
    set((current) => {
      if (key === 'del') return current.slice(0, -1);
      const next = (current + key).replace(/^0+/, '');
      return next.length > MAX_DIGITS ? current : next;
    });
  }

  const pay = useMutation({
    mutationFn: async () => {
      const { data: created } = await api.post<BillCheckout | { code: string; split: true }>(
        '/dining/bills',
        { ...input, splitInto },
        { headers: { 'idempotency-key': idempotencyKey.current } },
      );
      // A split bill has no single payment: the host lands on the split screen.
      if ('split' in created) return { code: created.code };
      const checkout = created;
      const outcome = await openCheckout(checkout, {
        description: `Bill at ${restaurant.name}`,
        notes: { billCode: checkout.code },
      });
      const { data: bill } = await api.post<Bill>(`/dining/bills/${checkout.code}/verify-payment`, {
        razorpayOrderId: outcome.orderId,
        razorpayPaymentId: outcome.paymentId,
        razorpaySignature: outcome.signature,
      });
      return bill;
    },
    onSuccess: (bill) => router.replace(`/bills/${bill.code}?fresh=1`),
    onError: (error) => {
      if (error instanceof Error && error.message === PAYMENT_CANCELLED) return;
      if (error instanceof ApiError && error.code === 'COUPON_INVALID') {
        setCoupon(null);
        toast.error('That code can’t be used', error.message);
        return;
      }
      if (error instanceof ApiError && error.code === 'BANK_OFFER_INVALID') {
        setBankOfferId(null);
        toast.error('That bank offer doesn’t apply', error.message);
        return;
      }
      if (error instanceof ApiError && error.code === 'WALLET_CHANGED') {
        void quote.refetch();
        toast.error('Your wallet balance changed', 'We’ve updated the bill — please check it again.');
        return;
      }
      toast.error('Payment didn’t go through', error instanceof Error ? error.message : 'Please try again.');
    },
  });

  function startPayment() {
    if (!user) {
      const draft = new URLSearchParams({
        bill,
        ...(hasExcluded && excluded ? { nd: excluded } : {}),
        ...(keepService ? { sc: '1' } : {}),
        ...(tip ? { tip: String(tip) } : {}),
        ...(coupon ? { code: coupon } : {}),
        ...(!useWallet ? { wallet: '0' } : {}),
        ...(bankOfferId ? { bank: bankOfferId } : {}),
        ...(splitting ? { split: String(splitInto) } : {}),
        step: 'review',
      });
      router.push(`/auth/login?next=${encodeURIComponent(`${pathname}?${draft}`)}&reason=pay`);
      return;
    }
    pay.mutate();
  }

  const header = (
    <header className="flex items-center gap-3 px-4 pb-2 pt-3 sm:px-0">
      <button
        onClick={() => (step === 'review' ? setStep('amount') : router.push(`/r/${restaurant.slug}`))}
        className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white ring-1 ring-ink-200"
        aria-label="Back"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <Photo src={restaurant.logoUrl} alt="" sizes="40px" className="h-10 w-10 shrink-0 rounded-xl" />
      <div className="min-w-0">
        <p className="truncate font-bold leading-tight">{restaurant.name}</p>
        <p className="truncate text-xs font-semibold text-save-700">
          {todaysTable?.offer ? `${todaysTable.offer.headline} · your pre-booked table` : (restaurant.walkinOffer ?? 'Pay your bill on Tixit')}
        </p>
      </div>
    </header>
  );

  if (step === 'review') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-ink-50">
        {header}
        <div className="flex-1 space-y-3 px-4 pb-6 pt-2 sm:px-0">
          <h1 className="text-2xl font-extrabold tracking-tight">Review &amp; pay</h1>
          {pricing ? (
            <>
              <Receipt
                pricing={pricing}
                restaurant={restaurant}
                subtitle={todaysTable ? `Table for ${todaysTable.partySize} · ${timeOnly(todaysTable.startsAt)}` : `${restaurant.locality} · walk-in`}
              />

              <div className="rounded-2xl bg-white ring-1 ring-ink-200">
                {pricing.coupon && coupon ? (
                  <div className="flex items-center gap-3 p-3.5 text-sm">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-save-50 text-save-600">
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </span>
                    <span className="flex-1">
                      <b className="text-brand-600">{coupon.toUpperCase()}</b> applied · {rupees(pricing.coupon.discountPaise)} off
                    </span>
                    <button onClick={() => setCoupon(null)} className="text-xs font-bold text-ink-500 hover:text-ink-800">
                      Remove
                    </button>
                  </div>
                ) : couponOpen ? (
                  <form
                    className="flex items-center gap-2 p-2.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setCoupon(couponInput.trim() || null);
                    }}
                  >
                    <input
                      value={couponInput}
                      onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
                      placeholder="Enter code"
                      className="input h-11 uppercase tracking-wider"
                      autoFocus
                      aria-label="Promo code"
                    />
                    <button className="press h-11 shrink-0 rounded-xl bg-ink-900 px-4 text-sm font-bold text-white">Apply</button>
                  </form>
                ) : (
                  <button onClick={() => setCouponOpen(true)} className="flex w-full items-center gap-3 p-3.5 text-left text-sm font-semibold">
                    <TicketPercent className="h-5 w-5 text-brand-600" /> Have a promo code?
                    <span className="ml-auto text-xs font-bold text-brand-600">Add</span>
                  </button>
                )}
                {coupon && pricing.couponError && (
                  <p className="flex items-center gap-2 border-t border-ink-100 px-3.5 py-2.5 text-xs font-semibold text-rose-600">
                    <X className="h-3.5 w-3.5" /> {pricing.couponError}
                  </p>
                )}
              </div>

              {!splitting && quote.data && quote.data.bankOptions.length > 0 && (
                <div className="rounded-2xl bg-white p-3.5 ring-1 ring-ink-200">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <CreditCard className="h-4 w-4 text-ink-400" /> Bank offers
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">Pick one, then pay with that bank’s card or UPI.</p>
                  <ul className="mt-2.5 space-y-2" role="radiogroup" aria-label="Bank offers">
                    {[{ id: null, title: 'No bank offer', bankName: null, unavailableReason: null, paymentMethods: [] as string[] }, ...quote.data.bankOptions].map((option) => {
                      const selected = bankOfferId === option.id;
                      const disabled = Boolean(option.unavailableReason);
                      return (
                        <li key={option.id ?? 'none'}>
                          <button
                            role="radio"
                            aria-checked={selected}
                            disabled={disabled}
                            onClick={() => setBankOfferId(option.id)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-xl p-3 text-left text-sm ring-1 ring-inset transition',
                              selected ? 'bg-save-50 ring-2 ring-save-500' : 'ring-ink-200 hover:ring-ink-300',
                              disabled && 'cursor-not-allowed opacity-50',
                            )}
                          >
                            <span className={cn('h-4 w-4 shrink-0 rounded-full ring-2 ring-inset', selected ? 'bg-save-600 ring-save-600' : 'ring-ink-300')} />
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold">{option.title}</span>
                              {option.id && (
                                <span className="block text-xs text-ink-500">
                                  {option.unavailableReason ??
                                    (option.paymentMethods.length
                                      ? `${option.bankName} · ${option.paymentMethods.map((m) => m.replace('_', ' ')).join(', ')}`
                                      : option.bankName)}
                                </span>
                              )}
                            </span>
                            {selected && pricing.bankOffer && (
                              <span className="num shrink-0 font-bold text-save-700">−{rupees(pricing.bankOffer.discountPaise)}</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {bankOfferId && pricing.bankOfferError && <p className="mt-2 text-xs font-semibold text-rose-600">{pricing.bankOfferError}</p>}
                </div>
              )}

              {pricing.convenienceFeePaise > 0 && (
                <Link href="/pass" className="flex items-center gap-3 rounded-2xl bg-white p-3.5 text-sm ring-1 ring-ink-200 hover:ring-ink-300">
                  <Crown className="h-5 w-5 shrink-0 text-brand-600" />
                  <span className="flex-1">
                    <b>Skip the {rupees(pricing.convenienceFeePaise)} fee</b> on every bill, and earn extra cashback, with Tixit Pass
                  </span>
                  <ChevronRight className="h-4 w-4 text-ink-400" />
                </Link>
              )}

              <SplitCard pricing={pricing.amountPayablePaise} value={splitInto} onChange={setSplitInto} hasBankOffers={Boolean(quote.data?.bankOptions.length)} />

              <SavingsBanner pricing={pricing} />
            </>
          ) : (
            <div className="grid h-60 place-items-center">
              <Spinner />
            </div>
          )}
        </div>

        <div className="safe-bottom sticky bottom-0 border-t border-ink-200 bg-white/95 px-4 pt-3 backdrop-blur-xl sm:rounded-t-3xl">
          <button
            onClick={startPayment}
            disabled={!pricing || pay.isPending || quote.isFetching}
            className="press flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-[16px] font-bold text-white shadow-glow transition hover:bg-brand-700 disabled:opacity-60"
          >
            {pay.isPending ? (
              <Spinner className="border-white/40 border-t-white" />
            ) : (
              <>
                {splitting ? <Users className="h-4 w-4" /> : <Lock className="h-4 w-4" />}{' '}
                {!user
                  ? splitting
                    ? 'Sign in to split'
                    : `Sign in to pay ${pricing ? rupees(pricing.amountPayablePaise, { decimals: true }) : ''}`
                  : splitting
                    ? `Split between ${splitInto}`
                    : `Pay ${pricing ? rupees(pricing.amountPayablePaise, { decimals: true }) : ''}`}
              </>
            )}
          </button>
          <p className="mt-2 pb-1 text-center text-[11px] text-ink-400">Secured by Razorpay · UPI · Cards · Netbanking</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-ink-50">
      {header}

      {todaysTable && (
        <div className="mx-4 mt-1 flex items-center gap-2 rounded-2xl bg-save-50 px-3.5 py-2.5 text-[13px] text-save-800 ring-1 ring-inset ring-save-100 sm:mx-0">
          <CalendarCheck2 className="h-4 w-4 shrink-0" />
          Paying for your {timeOnly(todaysTable.startsAt)} table ({todaysTable.code})
        </div>
      )}

      <section className="px-4 pt-4 text-center sm:px-0" aria-live="polite">
        <div className="inline-flex rounded-full bg-ink-100 p-1 text-xs font-bold">
          <button
            onClick={() => setField('bill')}
            className={cn('rounded-full px-3 py-1.5 transition', field === 'bill' ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500')}
          >
            Bill total
          </button>
          {hasExcluded && (
            <button
              onClick={() => setField('excluded')}
              className={cn('rounded-full px-3 py-1.5 transition', field === 'excluded' ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500')}
            >
              Not on offer
            </button>
          )}
        </div>
        <p className="num mt-3 text-[52px] font-black leading-none tracking-tight">
          <span className="mr-0.5 align-[14px] text-3xl text-ink-400">₹</span>
          {Number(field === 'bill' ? bill || 0 : excluded || 0).toLocaleString('en-IN')}
          <span className="ml-1 inline-block h-11 w-[3px] animate-pulse rounded-full bg-brand-600 align-[-6px]" aria-hidden />
        </p>
        <p className="mt-2 h-5 text-xs text-ink-500">
          {field === 'excluded'
            ? `of ${rupees(billValue * 100)} is alcohol or items the restaurant excludes`
            : billValue >= 1 && hasExcluded && excludedValue > 0
              ? `${rupees(excludedValue * 100)} not on offer`
              : 'Enter the total printed on your bill'}
        </p>
      </section>

      <section className="mt-3 space-y-2 px-4 sm:px-0">
        <Toggle
          checked={hasExcluded}
          onChange={(value) => {
            setHasExcluded(value);
            setField(value ? 'excluded' : 'bill');
            if (!value) setExcluded('');
          }}
          label="Bill has items not on offer?"
          description="e.g. alcohol — we won’t discount it"
        />
        {restaurant.serviceChargePercent > 0 && (
          <Toggle
            checked={keepService}
            onChange={setKeepService}
            label={`Add ${restaurant.serviceChargePercent}% service charge`}
            description="Optional · goes to the staff · never discounted"
          />
        )}
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-2.5 ring-1 ring-inset ring-ink-200">
          <span className="text-sm font-semibold">Tip the staff</span>
          <div className="flex gap-1.5">
            {TIPS.map((amount) => (
              <button
                key={amount}
                onClick={() => setTip(amount)}
                className={cn(
                  'press h-8 rounded-full px-3 text-xs font-bold',
                  tip === amount ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600',
                )}
              >
                {amount === 0 ? 'None' : `₹${amount}`}
              </button>
            ))}
          </div>
        </div>
      </section>

      {quote.data && quote.data.walletAvailablePaise > 0 && (
        <div className="mx-4 mt-2 sm:mx-0">
          <Toggle
            checked={useWallet}
            onChange={setUseWallet}
            label={`Use Tixit Wallet · ${rupees(quote.data.walletAvailablePaise)}`}
            description={
              useWallet && pricing?.walletUsedPaise
                ? `${rupees(pricing.walletUsedPaise)} applied to this bill`
                : 'Your cashback, spendable on any bill'
            }
          />
        </div>
      )}

      <div className="mx-4 mt-3 flex h-12 items-center justify-between rounded-2xl bg-save-50 px-4 text-sm text-save-800 ring-1 ring-inset ring-save-100 sm:mx-0">
        {pricing ? (
          <>
            <span>
              You save <b className="num text-base">{rupees(pricing.totalDiscountPaise)}</b>
            </span>
            <span>
              You pay <b className="num text-base">{rupees(pricing.amountPayablePaise)}</b>
            </span>
          </>
        ) : (
          <span className="w-full text-center text-save-700">Your saving appears as you type</span>
        )}
      </div>

      <div className="mt-auto px-3 pb-3 pt-4 sm:px-0">
        <div className="grid grid-cols-3 gap-1.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'].map((key) => (
            <button
              key={key}
              onClick={() => press(key)}
              className="press h-14 rounded-2xl bg-white text-2xl font-semibold text-ink-900 ring-1 ring-inset ring-ink-200 active:bg-ink-100"
              aria-label={key === 'del' ? 'Delete' : key}
            >
              {key === 'del' ? <Delete className="mx-auto h-6 w-6" /> : key}
            </button>
          ))}
        </div>
        <div className="safe-bottom pt-3">
          <button
            onClick={() => setStep('review')}
            disabled={billValue < 1 || !pricing}
            className="press h-14 w-full rounded-2xl bg-brand-600 text-[16px] font-bold text-white shadow-glow transition hover:bg-brand-700 disabled:bg-ink-200 disabled:text-ink-500 disabled:shadow-none"
          >
            {billValue < 1 ? 'Enter your bill amount' : 'Review bill'}
          </button>
          <Link href="/pay" className="mt-2 block text-center text-xs font-semibold text-ink-400">
            Not at {restaurant.name}? Pick another restaurant
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Split the payable amount. Offers and the host's wallet are already in the
 * price; each person pays an equal share from a link, and nothing is charged
 * to the restaurant until everyone has paid.
 */
function SplitCard({
  pricing: payablePaise,
  value,
  onChange,
  hasBankOffers,
}: {
  pricing: number;
  value: number;
  onChange: (value: number) => void;
  hasBankOffers: boolean;
}) {
  const max = Math.max(1, Math.min(MAX_SPLIT, Math.floor(payablePaise / MIN_SHARE_PAISE)));
  const people = Math.min(value, max);
  useEffect(() => {
    if (value > max) onChange(max);
  }, [value, max, onChange]);
  if (max < 2) return null;
  const each = Math.floor(payablePaise / people);
  const yours = payablePaise - each * (people - 1);

  return (
    <div className="rounded-2xl bg-white p-3.5 ring-1 ring-ink-200">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <Users className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Split the bill</p>
          <p className="text-xs text-ink-500">
            {people > 1
              ? `${rupees(each, { decimals: true })} each${yours !== each ? ` (yours ${rupees(yours, { decimals: true })})` : ''}. Friends pay from a link — no app needed, just a Tixit sign-in.`
              : 'Everyone pays their share from a link you send. Offers stay applied.'}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <Stepper value={people} onChange={onChange} min={1} max={max} unit={['person paying', 'people paying']} />
      </div>
      {people > 1 && hasBankOffers && (
        <p className="mt-2 text-[11px] text-ink-500">Bank offers apply when one card pays the whole bill, so they’re off while splitting.</p>
      )}
    </div>
  );
}
