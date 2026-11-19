'use client';

import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/format';

/**
 * A photo that never looks broken. A branded gradient sits underneath; the
 * image fades in over it once decoded, and simply stays hidden if it fails.
 */
export function Photo({
  src,
  alt,
  className,
  sizes = '100vw',
  priority = false,
  children,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  children?: React.ReactNode;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  return (
    <div className={cn('photo-fallback relative overflow-hidden', className)}>
      {src && state !== 'failed' && (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn(
            'object-cover transition-[opacity,transform] duration-700 ease-smooth',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      {children}
    </div>
  );
}
