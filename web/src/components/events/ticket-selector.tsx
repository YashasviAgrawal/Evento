'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus, ShoppingCart, Ticket } from 'lucide-react';
import type { EventDetail, TicketType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/index';
import { useAuth } from '@/components/providers/auth-provider';
import { cn, formatMoney, formatShortDate } from '@/lib/format';

const SALE_STATUS_LABEL: Record<TicketType['saleStatus'], string> = {
  on_sale: '',
  not_started: 'Not yet on sale',
  ended: 'Sales closed',
  sold_out: 'Sold out',
  inactive: 'Unavailable',
};

export function TicketSelector({ event }: { event: EventDetail }) {
  const router = useRouter();
  const { user } = useAuth();
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const bookable = event.status === 'published' && new Date(event.startsAt).getTime() > Date.now();

  const { subtotal, count } = useMemo(() => {
    let sum = 0;
    let items = 0;
    for (const tier of event.ticketTypes) {
      const quantity = quantities[tier.id] ?? 0;
      sum += tier.pricePaise * quantity;
      items += quantity;
    }
    return { subtotal: sum, count: items };
  }, [quantities, event.ticketTypes]);

  function adjust(tier: TicketType, delta: number) {
    setQuantities((current) => {
      const next = (current[tier.id] ?? 0) + delta;
      // Never exceed the per-order cap or what is actually left in stock.
      const ceiling = Math.min(tier.maxPerOrder, tier.available);
      const clamped = Math.max(0, Math.min(next, ceiling));

      if (clamped === 0) {
        const { [tier.id]: _removed, ...rest } = current;
        return rest;
      }
      // Respect the tier's minimum when going from zero.
      return { ...current, [tier.id]: clamped < tier.minPerOrder ? tier.minPerOrder : clamped };
    });
  }

  function proceed() {
    const selection = Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([id, quantity]) => `${id}:${quantity}`)
      .join(',');

    const target = `/checkout?event=${event.slug}&t=${encodeURIComponent(selection)}`;
    // Send guests through sign-in, then straight back into checkout.
    router.push(user ? target : `/auth/login?next=${encodeURIComponent(target)}`);
  }

  if (event.ticketTypes.length === 0) {
    return (
      <div className="rounded-xl border border-ink-200 bg-white p-6 text-center shadow-card">
        <Ticket className="mx-auto h-8 w-8 text-ink-300" aria-hidden />
        <p className="mt-3 text-sm font-medium text-ink-700">Tickets are not on sale yet</p>
        <p className="mt-1 text-xs text-ink-500">Check back soon — the organizer is still setting things up.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
      <div className="border-b border-ink-200 bg-ink-50 px-5 py-4">
        <h2 className="text-base font-bold text-ink-900">Select tickets</h2>
        <p className="mt-0.5 text-xs text-ink-500">Prices include all taxes shown at checkout</p>
      </div>

      <div className="divide-y divide-ink-100">
        {event.ticketTypes.map((tier) => {
          const quantity = quantities[tier.id] ?? 0;
          const disabled = !bookable || !tier.onSale;
          const ceiling = Math.min(tier.maxPerOrder, tier.available);

          return (
            <div key={tier.id} className={cn('flex items-start gap-4 px-5 py-4', disabled && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-ink-900">{tier.name}</h3>
                  {tier.seatsPerTicket > 1 && <Badge tone="info">Admits {tier.seatsPerTicket}</Badge>}
                  {tier.kind === 'early_bird' && tier.onSale && <Badge tone="success">Early bird</Badge>}
                </div>

                {tier.description && <p className="mt-1 text-xs text-ink-500">{tier.description}</p>}

                <p className="mt-1.5 text-base font-bold text-ink-900">
                  {tier.pricePaise === 0 ? <span className="text-emerald-600">Free</span> : formatMoney(tier.pricePaise)}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {disabled ? (
                    <span className="font-medium text-rose-600">{SALE_STATUS_LABEL[tier.saleStatus]}</span>
                  ) : tier.available <= 20 ? (
                    <span className="font-medium text-amber-600">Only {tier.available} left</span>
                  ) : (
                    <span className="text-ink-500">{tier.available} available</span>
                  )}

                  {tier.saleEndsAt && tier.onSale && (
                    <span className="text-ink-400">Sales end {formatShortDate(tier.saleEndsAt)}</span>
                  )}
                  <span className="text-ink-400">Max {tier.maxPerOrder} per order</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => adjust(tier, -1)}
                  disabled={disabled || quantity === 0}
                  aria-label={`Remove one ${tier.name} ticket`}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="w-8 text-center text-sm font-semibold tabular-nums text-ink-900" aria-live="polite">
                  {quantity}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => adjust(tier, 1)}
                  disabled={disabled || quantity >= ceiling}
                  aria-label={`Add one ${tier.name} ticket`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-ink-200 bg-ink-50 p-5">
        {count > 0 && (
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-ink-600">
              {count} {count === 1 ? 'ticket' : 'tickets'}
            </span>
            <span className="font-bold text-ink-900">{formatMoney(subtotal)}</span>
          </div>
        )}

        <Button size="lg" className="w-full" onClick={proceed} disabled={count === 0 || !bookable}>
          <ShoppingCart className="h-4 w-4" />
          {!bookable ? 'Booking closed' : count === 0 ? 'Select tickets to continue' : 'Proceed to checkout'}
        </Button>

        <p className="mt-2.5 text-center text-xs text-ink-500">
          Taxes and a convenience fee are calculated at checkout
        </p>
      </div>
    </div>
  );
}
