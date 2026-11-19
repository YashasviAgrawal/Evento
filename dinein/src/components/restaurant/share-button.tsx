'use client';

import { Share2 } from 'lucide-react';
import { useToast } from '@tixit/ui';

export function ShareButton({ title, className }: { title: string; className?: string }) {
  const toast = useToast();
  async function share() {
    const url = window.location.href.split('?')[0]!;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied');
      }
    } catch {
      // Dismissed share sheet — nothing to do.
    }
  }
  return (
    <button onClick={share} className={className} aria-label="Share">
      <Share2 className="h-4.5 w-4.5" />
    </button>
  );
}
