'use client';

import Image from 'next/image';
import { useState } from 'react';
import { cn } from './cn';

/** Brand gradient shown under every photo, and instead of one that fails. */
const FALLBACK: React.CSSProperties = {
  backgroundColor: '#2a1414',
  backgroundImage:
    'radial-gradient(circle at 25% 20%, rgb(225 29 72 / 0.55), transparent 55%), radial-gradient(circle at 80% 70%, rgb(124 58 237 / 0.35), transparent 55%), linear-gradient(135deg, #3b1d1d, #1e1b2e)',
};

/**
 * A photo that never looks broken. A branded gradient sits underneath; the
 * image fades in over it once decoded, and simply stays hidden if it fails.
 */
export function Photo({
  src,
  alt,
  className,
  imageClassName,
  sizes = '100vw',
  priority = false,
  children,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  imageClassName?: string;
  sizes?: string;
  priority?: boolean;
  children?: React.ReactNode;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  return (
    <div className={cn('relative overflow-hidden', className)} style={FALLBACK}>
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
            imageClassName,
          )}
        />
      )}
      {children}
    </div>
  );
}
