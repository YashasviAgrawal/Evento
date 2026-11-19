'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Photo } from '@/components/ui/photo';
import { cn } from '@/lib/format';

export interface LightboxPhoto {
  id: string;
  url: string;
  caption?: string;
}

/**
 * Thumbnails that open a full-screen viewer. Arrow keys and swipe-free
 * buttons to move, Escape to close; focus stays on the dialog.
 */
export function PhotoStrip({ photos, size = 'md', label }: { photos: LightboxPhoto[]; size?: 'sm' | 'md'; label: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <ul className={cn('scrollbar-none flex gap-2 overflow-x-auto', size === 'md' && '-mx-1 px-1 pb-1')} aria-label={label}>
        {photos.map((photo, index) => (
          <li key={photo.id} className="shrink-0">
            <button
              type="button"
              onClick={() => setOpen(index)}
              className={cn(
                'press block overflow-hidden rounded-xl ring-1 ring-ink-200 focus-visible:ring-2 focus-visible:ring-brand-500',
                size === 'md' ? 'h-28 w-28 sm:h-32 sm:w-32' : 'h-16 w-16',
              )}
              aria-label={`Open photo ${index + 1} of ${photos.length}`}
            >
              <Photo src={photo.url} alt="" sizes={size === 'md' ? '128px' : '64px'} className="h-full w-full" />
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <Lightbox photos={photos} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Lightbox({ photos, start, onClose }: { photos: LightboxPhoto[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const move = useCallback((step: number) => setIndex((i) => (i + step + photos.length) % photos.length), [photos.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') move(1);
      if (event.key === 'ArrowLeft') move(-1);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [move, onClose]);

  const photo = photos[index]!;
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo viewer" className="fixed inset-0 z-[70] flex flex-col bg-ink-950/95 text-white">
      <div className="flex items-center justify-between p-4">
        <span className="num text-sm text-ink-300">
          {index + 1} / {photos.length}
        </span>
        <button type="button" autoFocus onClick={onClose} className="press grid h-10 w-10 place-items-center rounded-full bg-white/10" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <Photo key={photo.id} src={photo.url} alt={photo.caption ?? ''} sizes="100vw" fallback={false} className="h-full w-full" imageClassName="!object-contain" />
        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => move(-1)} className="press absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10" aria-label="Previous photo">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button type="button" onClick={() => move(1)} className="press absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10" aria-label="Next photo">
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
      {photo.caption && <p className="p-4 text-center text-sm text-ink-300">{photo.caption}</p>}
    </div>
  );
}
