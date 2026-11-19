'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/format';

export function Toggle({
  checked,
  onChange,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-center justify-between gap-4 rounded-2xl bg-white px-4 py-3 text-left ring-1 ring-inset ring-ink-200 transition hover:ring-ink-300',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-900">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-500">{description}</span>}
      </span>
      <span
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-brand-600' : 'bg-ink-300',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-card transition-transform duration-300 ease-smooth',
            checked && 'translate-x-5',
          )}
        />
      </span>
    </button>
  );
}

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 12,
  unit,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  unit: [string, string];
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-ink-50 p-2 ring-1 ring-inset ring-ink-100">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="press grid h-12 w-12 place-items-center rounded-xl bg-white text-ink-800 shadow-card ring-1 ring-ink-200 disabled:opacity-40"
        aria-label={`Fewer ${unit[1]}`}
      >
        <Minus className="h-5 w-5" />
      </button>
      <div className="text-center" aria-live="polite">
        <div className="num text-3xl font-black tracking-tight">{value}</div>
        <div className="text-xs font-medium text-ink-500">{value === 1 ? unit[0] : unit[1]}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="press grid h-12 w-12 place-items-center rounded-xl bg-white text-ink-800 shadow-card ring-1 ring-ink-200 disabled:opacity-40"
        aria-label={`More ${unit[1]}`}
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}

export function Chip({
  active,
  children,
  onClick,
  className,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'press inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors',
        active ? 'bg-ink-900 text-white' : 'bg-white text-ink-700 ring-1 ring-inset ring-ink-200 hover:ring-ink-300',
        className,
      )}
    >
      {children}
    </button>
  );
}
