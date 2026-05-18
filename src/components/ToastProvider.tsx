/* eslint-disable */
// @ts-nocheck
/**
 * Toasts — non-blocking notifications that slide in from the top-right and
 * auto-dismiss. Replaces every blocking `alert()` call in the app.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Proposal created');
 *   toast.error('Save failed: …');
 *   toast.warning('No baseline rate set');
 *
 * The provider mounts at the app root and exposes the API via context. Each
 * toast renders for 4s by default (errors stay 6s so they're not missed).
 * Multiple toasts stack vertically.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Variant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  variant: Variant;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((message: string, variant: Variant) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
    // Errors get a longer lifetime so the user has a chance to read them.
    const ttl = variant === 'error' ? 6000 : 4000;
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ttl);
  }, []);

  const api: ToastApi = {
    success: (m) => push(m, 'success'),
    error:   (m) => push(m, 'error'),
    warning: (m) => push(m, 'warning'),
    info:    (m) => push(m, 'info'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.variant}`}>
            <span className="toast-icon" aria-hidden="true">
              {t.variant === 'success' ? '✓' : t.variant === 'error' ? '✕' : t.variant === 'warning' ? '!' : 'i'}
            </span>
            <span className="toast-message">{t.message}</span>
            <button
              className="toast-close"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              aria-label="Dismiss"
            >×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Allow components to call toast.* before the provider mounts (e.g. in
    // tests) — fall back to console so we never crash the app.
    return {
      success: (m) => console.log('[toast.success]', m),
      error:   (m) => console.error('[toast.error]', m),
      warning: (m) => console.warn('[toast.warning]', m),
      info:    (m) => console.info('[toast.info]', m),
    };
  }
  return ctx;
}
