'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/format';

type Tone = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (input: { tone?: Tone; title: string; description?: string }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONES: Record<Tone, { cls: string; Icon: typeof Info }> = {
  success: { cls: 'border-emerald-200 bg-white text-emerald-900', Icon: CheckCircle2 },
  error: { cls: 'border-rose-200 bg-white text-rose-900', Icon: XCircle },
  info: { cls: 'border-sky-200 bg-white text-sky-900', Icon: Info },
  warning: { cls: 'border-amber-200 bg-white text-amber-900', Icon: AlertCircle },
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    ({ tone = 'info', title, description }: { tone?: Tone; title: string; description?: string }) => {
      const id = nextId++;
      setToasts((current) => [...current, { id, tone, title, description }]);
      // Errors linger a little longer — they usually need reading.
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ tone: 'success', title, description }),
      error: (title, description) => toast({ tone: 'error', title, description }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
        aria-live="polite"
      >
        {toasts.map((item) => {
          const { cls, Icon } = TONES[item.tone];
          return (
            <div
              key={item.id}
              className={cn(
                'pointer-events-auto flex animate-fade-up items-start gap-3 rounded-xl border p-3.5 shadow-lift',
                cls,
              )}
            >
              <Icon className="mt-0.5 h-4.5 w-4.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.title}</p>
                {item.description && <p className="mt-0.5 text-xs leading-relaxed opacity-80">{item.description}</p>}
              </div>
              <button
                onClick={() => dismiss(item.id)}
                className="shrink-0 opacity-50 transition hover:opacity-100"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
