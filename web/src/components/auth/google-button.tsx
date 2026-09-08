'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui/index';

/**
 * "Continue with Google", rendered by Google Identity Services.
 *
 * GIS is loaded from Google's CDN and asked to draw the button itself, because
 * a hand-rolled button is not allowed to carry Google branding and would not
 * get the account-chooser popup. On success Google hands us a `credential` —
 * a short-lived ID token — which the server verifies. Nothing here trusts the
 * token's contents; the browser only ferries it across.
 *
 * Renders nothing at all when NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset, so the
 * login form degrades to email and password rather than showing a dead button.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client';

interface CredentialResponse {
  credential?: string;
}

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        ux_mode?: 'popup' | 'redirect';
      }) => void;
      renderButton: (
        parent: HTMLElement,
        options: {
          type?: 'standard' | 'icon';
          theme?: 'outline' | 'filled_blue' | 'filled_black';
          size?: 'small' | 'medium' | 'large';
          text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
          shape?: 'rectangular' | 'pill' | 'circle' | 'square';
          width?: number;
          logo_alignment?: 'left' | 'center';
        },
      ) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

/** One shared load promise: the script must not be injected once per mount. */
let scriptPromise: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google script failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Google script failed to load'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export interface GoogleButtonProps {
  /** Called with the Google ID token. Throw to surface an error to the user. */
  onCredential: (credential: string) => Promise<void> | void;
  /** Button copy — "continue_with" on login, "signup_with" on registration. */
  text?: 'signin_with' | 'signup_with' | 'continue_with';
  /**
   * Renders an "or" rule under the button. It belongs to this component rather
   * than the page so that both disappear together — a divider separating the
   * email form from nothing at all is worse than no divider.
   */
  dividerLabel?: string;
  disabled?: boolean;
}

export function GoogleButton({
  onCredential,
  text = 'continue_with',
  dividerLabel,
  disabled = false,
}: GoogleButtonProps) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'busy' | 'unavailable'>('loading');

  // A ref, not a dependency: the parent re-creates this callback on every
  // render, and re-initializing GIS each time would tear down the button.
  const handlerRef = useRef(onCredential);
  handlerRef.current = onCredential;

  const handleCredential = useCallback(async (response: CredentialResponse) => {
    if (!response.credential) return;
    setStatus('busy');
    try {
      await handlerRef.current(response.credential);
    } finally {
      setStatus('ready');
    }
  }, []);

  useEffect(() => {
    if (!clientId) {
      setStatus('unavailable');
      return;
    }

    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => void handleCredential(response),
          cancel_on_tap_outside: true,
        });
        containerRef.current.replaceChildren();
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          logo_alignment: 'center',
          // GIS needs a pixel width; it does not accept percentages.
          width: containerRef.current.offsetWidth || 360,
        });
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable');
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, text, handleCredential]);

  // No client ID configured, or Google is blocked/unreachable — say nothing and
  // let the email forms carry the page.
  if (!clientId || status === 'unavailable') return null;

  return (
    <>
      <div className="relative">
        <div
          ref={containerRef}
          className={
            status === 'busy' || disabled
              ? 'pointer-events-none flex justify-center opacity-50'
              : 'flex justify-center'
          }
        />
        {status === 'loading' && (
          <div className="flex h-[44px] items-center justify-center rounded-md border border-ink-200">
            <Spinner className="h-4 w-4" />
          </div>
        )}
        {status === 'busy' && (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner className="h-5 w-5" />
          </div>
        )}
      </div>
      {dividerLabel && <AuthDivider label={dividerLabel} />}
    </>
  );
}

/** "or" rule separating the Google button from the email forms. */
export function AuthDivider({ label = 'or' }: { label?: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-ink-200" />
      <span className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</span>
      <span className="h-px flex-1 bg-ink-200" />
    </div>
  );
}
