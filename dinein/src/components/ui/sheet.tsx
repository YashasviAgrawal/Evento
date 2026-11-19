'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/format';

/**
 * A bottom sheet on phones and a centred dialog from `sm` up — one component,
 * so booking and filters feel native in the hand and calm on a desk.
 * Escape and the scrim close it; page scroll is locked while it is open.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <button
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 animate-fade-in bg-ink-950/55 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-20px_40px_-10px_rgb(2_6_23/0.4)] outline-none',
          'animate-sheet-up sm:max-w-lg sm:animate-enter sm:rounded-3xl',
          className,
        )}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-ink-200 sm:hidden" aria-hidden />
        <header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-2 pt-3 sm:pt-5">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold tracking-tight text-ink-900">{title}</h2>
            {subtitle && <div className="mt-0.5 text-[13px] text-ink-500">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="press -mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-600 hover:bg-ink-200"
            aria-label="Close"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <footer className="safe-bottom shrink-0 border-t border-ink-100 bg-white px-5 pt-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
