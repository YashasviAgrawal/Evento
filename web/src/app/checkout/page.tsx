'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Lock,
  MapPin,
  ShieldCheck,
  Tag,
  Timer,
  X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { loadRazorpay, openCheckout } from '@/lib/razorpay';
import type { AvailableCoupon, CheckoutSession, CreatedBooking, EventDetail, PriceBreakdown } from '@/lib/types';
import { useAuth } from '@/components/providers/auth-provider';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Spinner, Textarea } from '@/components/ui/index';
import { cn, formatEventDateTime, formatMoney } from '@/lib/format';

type Step = 'details' | 'paying' | 'done';

export default function CheckoutPage() {
  return (
    <Suspense fallback={<CheckoutLoading />}>
      <CheckoutFlow />
    </Suspense>
  );
}

function CheckoutLoading() {
  return (
    <div className="container-page grid min-h-[60vh] place-items-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

function CheckoutFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();

  const eventSlug = searchParams.get('event') ?? '';
  const selectionParam = searchParams.get('t') ?? '';

  /** "<ticketTypeId>:<qty>,<ticketTypeId>:<qty>" → typed line items. */
  const items = useMemo(() => {
    return selectionParam
      .split(',')
      .filter(Boolean)
      .map((pair) => {
        const [ticketTypeId, quantity] = pair.split(':');
        return { ticketTypeId: ticketTypeId ?? '', quantity: Number(quantity ?? 0) };
      })
      .filter((item) => item.ticketTypeId && item.quantity > 0);
  }, [selectionParam]);

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [quote, setQuote] = useState<PriceBreakdown | null>(null);
  const [step, setStep] = useState<Step>('details');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const [offers, setOffers] = useState<AvailableCoupon[]>([]);

  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [booking, setBooking] = useState<CreatedBooking | null>(null);
  const [holdSecondsLeft, setHoldSecondsLeft] = useState<number | null>(null);

  /**
   * Where to send a guest to sign in, returning them to this exact cart.
   * Deliberately not triggered on mount — guests are allowed to see the full
   * order summary and total first, and are only asked to sign in when they
   * actually press Pay.
   */
  const loginHref = `/auth/login?next=${encodeURIComponent(
    `/checkout?event=${eventSlug}&t=${encodeURIComponent(selectionParam)}`,
  )}`;

  useEffect(() => {
    if (user) {
      setForm((current) => ({
        ...current,
        name: current.name || user.fullName,
        email: current.email || user.email,
        phone: current.phone || (user.phone ?? ''),
      }));
    }
  }, [user]);

  const loadQuote = useCallback(
    async (coupon?: string) => {
      if (!eventSlug || items.length === 0) return;
      try {
        const eventResponse = await api.get<EventDetail>(`/events/${eventSlug}`);
        setEvent(eventResponse.data);

        // Nobody guesses a promo code, so show what is actually usable here.
        api
          .get<AvailableCoupon[]>(`/events/${eventResponse.data.id}/coupons`)
          .then((response) => setOffers(response.data))
          .catch(() => setOffers([]));

        const { data } = await api.post<PriceBreakdown>('/bookings/quote', {
          eventId: eventResponse.data.id,
          items,
          couponCode: coupon || undefined,
        });
        setQuote(data);

        if (coupon) {
          if (data.couponError) {
            setCouponError(data.couponError);
            setAppliedCoupon(null);
          } else {
            setAppliedCoupon(data.couponCode ?? coupon);
            setCouponError(null);
          }
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'We could not price this order');
      } finally {
        setLoading(false);
        setApplyingCoupon(false);
      }
    },
    [eventSlug, items],
  );

  // Quoting is open to guests, so this no longer waits for a signed-in user.
  useEffect(() => {
    void loadQuote();
  }, [loadQuote]);

  // Countdown on the inventory hold, so the customer knows the clock is running.
  useEffect(() => {
    if (!booking?.holdExpiresAt) return;
    const expiry = new Date(booking.holdExpiresAt).getTime();

    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      setHoldSecondsLeft(remaining);
      if (remaining === 0) {
        setError('Your reservation expired. Please start again.');
        setStep('details');
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [booking]);

  useEffect(() => {
    void loadRazorpay();
  }, []);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (form.name.trim().length < 2) errors.name = 'Enter the attendee’s full name';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address';
    if (!/^(\+?\d{1,3}[- ]?)?\d{10}$/.test(form.phone.trim())) errors.phone = 'Enter a valid 10-digit phone number';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function applyCoupon() {
    if (!couponInput.trim()) return;
    setApplyingCoupon(true);
    setCouponError(null);
    await loadQuote(couponInput.trim().toUpperCase());
  }

  function removeCoupon() {
    setCouponInput('');
    setAppliedCoupon(null);
    setCouponError(null);
    void loadQuote();
  }

  /**
   * Reserve → pay → verify.
   * Each stage is separately recoverable: a failed payment leaves the booking
   * pending (and the seats held) so the customer can retry without re-picking.
   */
  async function handlePay() {
    if (!event || !validate()) return;

    // The sign-in gate sits here rather than on page load, so a guest can pick
    // tickets, apply a coupon and see the real total before committing.
    if (!user) {
      router.push(loginHref);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // 1. Reserve inventory.
      let current = booking;
      if (!current || current.status !== 'pending') {
        const { data } = await api.post<CreatedBooking>('/bookings', {
          eventId: event.id,
          items,
          couponCode: appliedCoupon ?? undefined,
          customerName: form.name.trim(),
          customerEmail: form.email.trim(),
          customerPhone: form.phone.trim(),
          notes: form.notes.trim() || undefined,
        });
        current = data;
        setBooking(data);
      }

      // A free event is confirmed by the API without a payment step.
      if (!current.requiresPayment || current.status === 'confirmed') {
        setStep('done');
        toast.success('Booking confirmed', 'Your tickets are ready.');
        router.push(`/account/bookings/${current.id}?new=1`);
        return;
      }

      // 2. Create the gateway order and open the payment sheet.
      setStep('paying');
      const { data: session } = await api.post<CheckoutSession>('/payments/checkout', { bookingId: current.id });
      const outcome = await openCheckout(session);

      // 3. Server-side signature verification is what actually confirms it.
      await api.post('/payments/verify', {
        bookingId: current.id,
        razorpayOrderId: outcome.orderId,
        razorpayPaymentId: outcome.paymentId,
        razorpaySignature: outcome.signature,
      });

      setStep('done');
      toast.success('Payment successful', 'Your QR tickets are ready.');
      router.push(`/account/bookings/${current.id}?new=1`);
    } catch (err) {
      setStep('details');
      if (err instanceof Error && err.message === 'PAYMENT_CANCELLED') {
        setError('Payment was cancelled. Your tickets are still reserved — you can try again.');
      } else if (err instanceof ApiError) {
        setError(err.fieldMessages[0] ?? err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || loading) return <CheckoutLoading />;

  if (items.length === 0 || !event) {
    return (
      <div className="container-page py-16">
        <Alert tone="warning" title="Nothing to check out">
          Your ticket selection is empty or the link has expired.{' '}
          <Link href="/events" className="font-semibold underline">
            Browse events
          </Link>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container-page py-8 lg:py-10">
      <Link
        href={`/events/${event.slug}`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to event
      </Link>

      <Steps step={step} />

      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_400px]">
        {/* ── Left: details ── */}
        <div className="min-w-0 space-y-5">
          {error && (
            <Alert tone="error" title="We hit a problem" onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}

          {holdSecondsLeft !== null && holdSecondsLeft > 0 && (
            <Alert tone="warning">
              <span className="flex items-center gap-1.5 font-medium">
                <Timer className="h-4 w-4" aria-hidden />
                Your seats are held for {Math.floor(holdSecondsLeft / 60)}:
                {String(holdSecondsLeft % 60).padStart(2, '0')}
              </span>
            </Alert>
          )}

          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
            <h2 className="text-base font-bold text-ink-900">Attendee details</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Tickets and the confirmation email are sent to the address below
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required error={fieldErrors.name}>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Aarav Sharma"
                  invalid={Boolean(fieldErrors.name)}
                  autoComplete="name"
                />
              </Field>

              <Field label="Email" required error={fieldErrors.email}>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                  invalid={Boolean(fieldErrors.email)}
                  autoComplete="email"
                />
              </Field>

              <Field label="Phone" required error={fieldErrors.phone} className="sm:col-span-2">
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="9876543210"
                  invalid={Boolean(fieldErrors.phone)}
                  autoComplete="tel"
                />
              </Field>

              <Field label="Notes for the organizer" hint="Optional" className="sm:col-span-2">
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Accessibility needs, dietary preferences…"
                  rows={3}
                  maxLength={500}
                />
              </Field>
            </div>
          </section>

          {/* ── Coupon ── */}
          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
              <Tag className="h-4 w-4 text-brand-600" aria-hidden />
              Have a coupon?
            </h2>

            {appliedCoupon ? (
              <div className="mt-4 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  <span className="font-mono font-bold">{appliedCoupon}</span> applied — you saved{' '}
                  {formatMoney(quote?.discountPaise ?? 0)}
                </span>
                <button
                  onClick={removeCoupon}
                  className="text-emerald-700 transition hover:text-emerald-900"
                  aria-label="Remove coupon"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="mt-4">
                <div className="flex gap-2">
                  <Input
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && applyCoupon()}
                    placeholder="Enter code"
                    className="font-mono uppercase"
                    invalid={Boolean(couponError)}
                  />
                  <Button variant="outline" onClick={applyCoupon} loading={applyingCoupon} disabled={!couponInput.trim()}>
                    Apply
                  </Button>
                </div>
                {couponError && <p className="mt-2 text-xs text-rose-600">{couponError}</p>}

                {/* Available offers, so nobody has to already know a code. */}
                {offers.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Available offers
                    </p>
                    <ul className="mt-2 space-y-2">
                      {offers.map((offer) => {
                        const subtotal = quote?.subtotalPaise ?? 0;
                        const shortfall = offer.minOrderPaise - subtotal;
                        const eligible = shortfall <= 0;

                        return (
                          <li
                            key={offer.code}
                            className={cn(
                              'flex items-center justify-between gap-3 rounded-lg border border-dashed p-3 transition',
                              eligible ? 'border-brand-300 bg-brand-50/50' : 'border-ink-200 bg-ink-50',
                            )}
                          >
                            <div className="min-w-0">
                              <p className="flex items-center gap-2">
                                <span className="font-mono text-sm font-bold text-ink-900">{offer.code}</span>
                                <span className="text-xs font-medium text-brand-700">{offer.label}</span>
                              </p>
                              {!eligible && (
                                <p className="mt-0.5 text-xs text-ink-500">
                                  Add {formatMoney(shortfall)} more to use this
                                </p>
                              )}
                              {eligible && offer.description && (
                                <p className="mt-0.5 truncate text-xs text-ink-500">{offer.description}</p>
                              )}
                            </div>

                            <Button
                              size="sm"
                              variant={eligible ? 'primary' : 'ghost'}
                              disabled={!eligible || applyingCoupon}
                              onClick={() => {
                                setCouponInput(offer.code);
                                setApplyingCoupon(true);
                                setCouponError(null);
                                void loadQuote(offer.code);
                              }}
                            >
                              Apply
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Payment methods ── */}
          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
              <CreditCard className="h-4 w-4 text-brand-600" aria-hidden />
              Payment
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Secured by Razorpay. Choose your method on the next screen.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {['UPI', 'Credit Card', 'Debit Card', 'Net Banking'].map((method) => (
                <div
                  key={method}
                  className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5 text-center text-xs font-medium text-ink-700"
                >
                  {method}
                </div>
              ))}
            </div>

            <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-500">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Your card details never touch our servers.
            </p>
          </section>
        </div>

        {/* ── Right: order summary ── */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
            <div className="flex gap-3 border-b border-ink-200 p-4">
              {event.thumbnailUrl && (
                <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-ink-100">
                  <Image src={event.thumbnailUrl} alt="" fill sizes="96px" className="object-cover" />
                </div>
              )}
              <div className="min-w-0">
                <h3 className="line-clamp-2 text-sm font-bold text-ink-900">{event.title}</h3>
                <p className="mt-1 flex items-center gap-1 text-xs text-ink-500">
                  <CalendarDays className="h-3 w-3 shrink-0" aria-hidden />
                  {formatEventDateTime(event.startsAt)}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">
                    {event.venue.name}, {event.city.name}
                  </span>
                </p>
              </div>
            </div>

            <div className="p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Order summary</h4>

              <div className="mt-3 space-y-2.5">
                {quote?.lines.map((line) => (
                  <div key={line.ticketTypeId} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 text-ink-700">
                      <span className="font-medium">{line.name}</span>
                      <span className="text-ink-400"> × {line.quantity}</span>
                    </span>
                    <span className="shrink-0 font-medium text-ink-900">{formatMoney(line.subtotalPaise)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2 border-t border-ink-100 pt-4 text-sm">
                <Row label="Subtotal" value={formatMoney(quote?.subtotalPaise ?? 0)} />
                {(quote?.discountPaise ?? 0) > 0 && (
                  <Row
                    label={`Discount (${appliedCoupon})`}
                    value={`−${formatMoney(quote!.discountPaise)}`}
                    valueClassName="text-emerald-600"
                  />
                )}
                <Row label="GST" value={formatMoney(quote?.taxPaise ?? 0)} />
                <Row label="Convenience fee" value={formatMoney(quote?.convenienceFeePaise ?? 0)} />
              </div>

              <div className="mt-4 flex items-baseline justify-between border-t border-ink-200 pt-4">
                <span className="text-sm font-semibold text-ink-900">Total payable</span>
                <span className="text-xl font-extrabold text-ink-900">{formatMoney(quote?.totalPaise ?? 0, { withDecimals: true })}</span>
              </div>

              <Button
                size="lg"
                className="mt-5 w-full"
                onClick={handlePay}
                loading={submitting}
                disabled={submitting || step === 'done'}
              >
                {step === 'paying'
                  ? 'Completing payment…'
                  : !user
                    ? `Sign in to pay ${formatMoney(quote?.totalPaise ?? 0)}`
                    : `Pay ${formatMoney(quote?.totalPaise ?? 0)}`}
              </Button>

              {!user && (
                <p className="mt-2 text-center text-xs text-ink-500">
                  You&apos;ll come straight back here — your tickets are kept.
                </p>
              )}

              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-ink-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                100% secure payment · Instant QR ticket
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-600">{label}</span>
      <span className={cn('font-medium text-ink-900', valueClassName)}>{value}</span>
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const steps = [
    { key: 'details', label: 'Your details' },
    { key: 'paying', label: 'Payment' },
    { key: 'done', label: 'Ticket' },
  ];
  const activeIndex = steps.findIndex((entry) => entry.key === step);

  return (
    <ol className="flex items-center gap-2 text-sm">
      {steps.map((entry, index) => {
        const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo';
        return (
          <li key={entry.key} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold transition',
                state === 'done' && 'bg-emerald-600 text-white',
                state === 'active' && 'bg-brand-600 text-white',
                state === 'todo' && 'bg-ink-200 text-ink-500',
              )}
            >
              {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
            </span>
            <span
              className={cn(
                'hidden truncate text-xs font-medium sm:block',
                state === 'todo' ? 'text-ink-400' : 'text-ink-900',
              )}
            >
              {entry.label}
            </span>
            {index < steps.length - 1 && (
              <span className={cn('h-0.5 flex-1 rounded', index < activeIndex ? 'bg-emerald-500' : 'bg-ink-200')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
