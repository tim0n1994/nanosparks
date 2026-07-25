'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ToastTone = 'neutral' | 'success' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  /** Optional single action, e.g. "继续阅读". Dismisses the toast when pressed. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before auto-dismiss. Pass 0 to require an explicit dismiss. */
  durationMs?: number;
}

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  /** Show a transient message. Fire-and-forget. */
  toast: (message: string, toneOrOptions?: ToastTone | ToastOptions) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => {} });

const TONES: Record<ToastTone, string> = {
  neutral: 'bg-ink text-surface-raised',
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
};

const DEFAULT_DISMISS_MS = 3200;
/** Toasts carrying an action stay longer — the user has to read and decide. */
const ACTION_DISMISS_MS = 8000;

let nextId = 0;

/**
 * One toast host for the whole app, mounted in the root layout.
 * The live region is polite so it never interrupts a screen reader mid-sentence.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, toneOrOptions: ToastTone | ToastOptions = 'neutral') => {
      const opts: ToastOptions =
        typeof toneOrOptions === 'string' ? { tone: toneOrOptions } : toneOrOptions;
      const id = nextId++;
      setToasts((prev) => [
        ...prev,
        { id, message, tone: opts.tone ?? 'neutral', action: opts.action },
      ]);
      const ms = opts.durationMs ?? (opts.action ? ACTION_DISMISS_MS : DEFAULT_DISMISS_MS);
      if (ms > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ms),
        );
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex max-w-sm items-center gap-3 rounded-lg px-4 py-2 text-sm font-medium shadow-lg',
              TONES[t.tone],
            )}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 rounded px-2 py-0.5 underline underline-offset-2 hover:opacity-80"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
