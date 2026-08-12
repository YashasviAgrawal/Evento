'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, MessageCircle, Share2, Twitter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/format';

/**
 * Share an event.
 *
 * On phones this hands off to the OS share sheet, which is what people
 * actually expect and covers every app they have installed. Desktop browsers
 * mostly lack that API, so they get an explicit menu instead.
 */
export function ShareButton({
  title,
  text,
  className,
  variant = 'outline',
}: {
  title: string;
  text?: string;
  className?: string;
  variant?: 'outline' | 'ghost' | 'secondary';
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Feature-detect after mount so server and first client render agree.
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function currentUrl(): string {
    return typeof window === 'undefined' ? '' : window.location.href;
  }

  async function handleClick() {
    const url = currentUrl();

    if (canNativeShare) {
      try {
        await navigator.share({ title, text: text ?? title, url });
        return;
      } catch (err) {
        // AbortError just means the user dismissed the sheet — not a failure.
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }
    setOpen((value) => !value);
  }

  async function copyLink() {
    const url = currentUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy the link');
    }
    setOpen(false);
  }

  const shareText = encodeURIComponent(`${title}${text ? ` — ${text}` : ''}`);
  const shareUrl = encodeURIComponent(currentUrl());

  return (
    <div className="relative" ref={menuRef}>
      <Button variant={variant} size="sm" onClick={handleClick} className={className} aria-expanded={open}>
        <Share2 className="h-4 w-4" />
        Share
      </Button>

      {open && !canNativeShare && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-52 animate-fade-up overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lift"
        >
          <button
            onClick={copyLink}
            role="menuitem"
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-ink-700 transition hover:bg-ink-100"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4 text-ink-400" />
            )}
            {copied ? 'Copied!' : 'Copy link'}
          </button>

          <a
            href={`https://wa.me/?text=${shareText}%20${shareUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-ink-700 transition hover:bg-ink-100"
          >
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            WhatsApp
          </a>

          <a
            href={`https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-ink-700 transition hover:bg-ink-100"
          >
            <Twitter className="h-4 w-4 text-sky-500" />
            Twitter
          </a>

          <a
            href={`mailto:?subject=${encodeURIComponent(title)}&body=${shareText}%20${shareUrl}`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(
              'flex items-center gap-2.5 px-3.5 py-2 text-sm text-ink-700 transition hover:bg-ink-100',
            )}
          >
            <Link2 className="h-4 w-4 text-ink-400" />
            Email
          </a>
        </div>
      )}
    </div>
  );
}
