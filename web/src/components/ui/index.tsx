'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn, STATUS_STYLES, statusLabel } from '@/lib/format';

/* ─────────────────────────── form fields ─────────────────────────── */

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="ml-0.5 text-brand-600">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn('input', invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-100', className)}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn('input min-h-[96px] resize-y', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'input cursor-pointer pr-8',
          invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-100',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

/* ───────────────────────────── display ───────────────────────────── */

export function Badge({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
    brand: 'bg-brand-50 text-brand-700 ring-brand-200',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warning: 'bg-amber-50 text-amber-700 ring-amber-200',
    danger: 'bg-rose-50 text-rose-700 ring-rose-200',
    info: 'bg-sky-50 text-sky-700 ring-sky-200',
  };
  return <span className={cn('badge', tones[tone ?? 'neutral'], className)}>{children}</span>;
}

/** Renders any backend status enum with a consistent colour mapping. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('badge', STATUS_STYLES[status] ?? STATUS_STYLES.draft, className)}>{statusLabel(status)}</span>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  onDismiss,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const config = {
    info: { cls: 'bg-sky-50 text-sky-800 border-sky-200', Icon: Info },
    success: { cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', Icon: CheckCircle2 },
    warning: { cls: 'bg-amber-50 text-amber-800 border-amber-200', Icon: AlertCircle },
    error: { cls: 'bg-rose-50 text-rose-800 border-rose-200', Icon: XCircle },
  }[tone];

  return (
    <div className={cn('flex gap-3 rounded-lg border p-3.5 text-sm', config.cls, className)} role="alert">
      <config.Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'leading-relaxed')}>{children}</div>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white px-6 py-14 text-center', className)}>
      {icon && <div className="mb-3 text-ink-400">{icon}</div>}
      <p className="text-base font-semibold text-ink-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn('h-5 w-5 animate-spin rounded-full border-2 border-ink-200 border-t-brand-600', className)}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Key/value pair used across detail panels. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-ink-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink-900">{value}</dd>
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h2 className="text-xl font-bold tracking-tight text-ink-900 sm:text-2xl">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
