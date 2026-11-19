'use client';

import { useRef, useState } from 'react';
import { Images } from 'lucide-react';
import { Photo } from '@/components/ui/photo';

/**
 * Full-bleed swipeable gallery on phones; a five-photo mosaic on desktop.
 */
export function Gallery({ name, photos }: { name: string; photos: string[] }) {
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const list = photos.length ? photos : [''];

  return (
    <>
      <div className="relative md:hidden">
        <div
          ref={track}
          onScroll={(event) => {
            const el = event.currentTarget;
            setIndex(Math.round(el.scrollLeft / el.clientWidth));
          }}
          className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto"
        >
          {list.map((url, i) => (
            <Photo key={i} src={url || null} alt={`${name} — photo ${i + 1}`} priority={i === 0} sizes="100vw" className="aspect-[4/3] w-full shrink-0 snap-center" />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-9 flex justify-center gap-1.5">
          {list.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full bg-white transition-all ${i === index ? 'w-5' : 'w-1.5 opacity-60'}`} />
          ))}
        </div>
      </div>

      <div className="container-page hidden pt-6 md:block">
        <div className="grid h-[420px] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-3xl">
          {list.slice(0, 5).map((url, i) => (
            <Photo
              key={i}
              src={url || null}
              alt={`${name} — photo ${i + 1}`}
              priority={i === 0}
              sizes={i === 0 ? '50vw' : '25vw'}
              className={i === 0 ? 'col-span-2 row-span-2' : ''}
            >
              {i === 4 && list.length > 5 && (
                <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-ink-900">
                  <Images className="h-3.5 w-3.5" /> {list.length} photos
                </span>
              )}
            </Photo>
          ))}
        </div>
      </div>
    </>
  );
}
