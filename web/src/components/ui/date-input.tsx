'use client';

import { CalendarDays, X } from 'lucide-react';
import { cn } from '@/lib/format';

/**
 * A date / date-time field that always reads dd/mm/yyyy.
 *
 * A native <input type="date"> formats its text by the browser's language,
 * so an English (US) browser shows mm/dd/yyyy and code cannot change that.
 * Here the native input still does the work — it is laid invisibly over the
 * field, so tapping opens the browser's own calendar — while the visible text
 * is formatted by us. The value is the same string the native input uses
 * ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"), so callers need no conversion.
 */
export function DateInput({
  type = 'date',
  value,
  onChange,
  invalid,
  clearable,
  className,
  ...rest
}: {
  type?: 'date' | 'datetime-local';
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  /** Show a clear button — for optional fields where blank means "none". */
  clearable?: boolean;
  className?: string;
  min?: string;
  max?: string;
  required?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          // Desktop browsers otherwise only open the calendar from their icon.
          try {
            e.currentTarget.showPicker();
          } catch {
            /* older browsers: the field still accepts typing */
          }
        }}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        {...rest}
      />
      <div
        aria-hidden
        className={cn(
          'input flex items-center justify-between gap-2',
          'peer-focus:border-brand-500 peer-focus:ring-2 peer-focus:ring-brand-100',
          invalid && 'border-rose-400',
        )}
      >
        <span className={value ? 'text-ink-900' : 'text-ink-400'}>
          {value ? formatDisplay(value) : type === 'date' ? 'dd/mm/yyyy' : 'dd/mm/yyyy, --:--'}
        </span>
        <CalendarDays className="h-4 w-4 shrink-0 text-ink-400" />
      </div>
      {clearable && value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-9 top-1/2 z-20 -translate-y-1/2 rounded p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
          aria-label="Clear date"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** "2026-10-17" → "17/10/2026"; "2026-10-17T18:30" → "17/10/2026, 6:30 PM". */
function formatDisplay(value: string): string {
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = (datePart ?? '').split('-');
  if (!year || !month || !day) return value;
  const date = `${day}/${month}/${year}`;
  if (!timePart) return date;

  const [h, m] = timePart.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return date;
  const hour12 = h % 12 || 12;
  return `${date}, ${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
