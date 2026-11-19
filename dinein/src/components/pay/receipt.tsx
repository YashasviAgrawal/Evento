import type { BillPricing } from '@/lib/types';
import { cn, rupees } from '@/lib/format';
import { Photo } from '@/components/ui/photo';

const FUNDER: Record<string, string> = {
  restaurant: 'Paid by the restaurant',
  platform: 'Paid by Tixit',
  bank: 'Paid by the bank',
  shared: 'Shared by the restaurant and a partner',
};

/**
 * The bill, itemised the way the money actually moves — each saving says who
 * pays for it. Uses the perforated-ticket card from Tixit event tickets.
 */
export function Receipt({
  pricing,
  restaurant,
  subtitle,
  className,
  footer,
}: {
  pricing: BillPricing;
  restaurant: { name: string; logoUrl: string | null };
  subtitle?: string;
  className?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className={cn('overflow-hidden rounded-3xl bg-white shadow-lift ring-1 ring-ink-200', className)}>
      <div className="flex items-center gap-3 p-4">
        <Photo src={restaurant.logoUrl} alt="" sizes="44px" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <p className="truncate font-bold">{restaurant.name}</p>
          {subtitle && <p className="truncate text-xs text-ink-500">{subtitle}</p>}
        </div>
      </div>
      <div className="perforation" aria-hidden>
        <i />
      </div>
      <dl className="num space-y-0.5 px-4 pb-3 pt-1 text-[14px]">
        {pricing.lines.map((line) => {
          const saving = line.amountPaise < 0;
          if (line.key === 'fee_waived') {
            return (
              <div key={line.key} className="flex items-start justify-between gap-4 py-1.5 text-ink-700">
                <dt className="min-w-0">
                  <span>{line.label}</span>
                  <span className="mt-0.5 block text-[10.5px] font-bold uppercase tracking-wider text-brand-600">Tixit Pass</span>
                </dt>
                <dd className="shrink-0 font-semibold text-save-700">Free</dd>
              </div>
            );
          }
          if (line.key === 'non_discountable') {
            return (
              <div key={line.key} className="py-1.5 text-xs text-ink-500">
                {line.note}
              </div>
            );
          }
          return (
            <div key={line.key} className={cn('flex items-start justify-between gap-4 py-1.5', saving ? 'text-save-700' : 'text-ink-700')}>
              <dt className="min-w-0">
                <span className={cn(saving && 'font-semibold')}>{line.label}</span>
                {line.fundedBy && (
                  <span className={cn('mt-0.5 block text-[10.5px] font-bold uppercase tracking-wider', saving ? 'text-save-500' : 'text-ink-400')}>
                    {FUNDER[line.fundedBy]}
                  </span>
                )}
                {line.note && line.key !== 'non_discountable' && <span className="mt-0.5 block text-[11px] text-ink-400">{line.note}</span>}
              </dt>
              <dd className={cn('shrink-0', saving && 'font-semibold')}>
                {saving ? '−' : ''}
                {rupees(Math.abs(line.amountPaise), { decimals: true })}
              </dd>
            </div>
          );
        })}
        <div className="mt-2 flex items-center justify-between border-t border-dashed border-ink-200 pt-3 text-base font-extrabold text-ink-900">
          <dt>You pay</dt>
          <dd>{rupees(pricing.amountPayablePaise, { decimals: true })}</dd>
        </div>
      </dl>
      {footer}
    </div>
  );
}

export function SavingsBanner({ pricing }: { pricing: BillPricing }) {
  if (pricing.totalDiscountPaise <= 0) return null;
  const percent = Math.round((pricing.totalDiscountPaise / pricing.billTotalPaise) * 100);
  return (
    <div className="flex items-center justify-between gap-4 rounded-3xl bg-ink-900 p-4 text-white">
      <div>
        <p className="eyebrow text-save-300">You save</p>
        <p className="num text-2xl font-black tracking-tight">{rupees(pricing.totalDiscountPaise)}</p>
      </div>
      <p className="max-w-[170px] text-right text-xs leading-relaxed text-ink-300">
        That’s {percent}% of your bill — shown before you pay, no surprises after.
      </p>
    </div>
  );
}
