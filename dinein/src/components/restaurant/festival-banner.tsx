import Link from 'next/link';
import { ArrowRight, PartyPopper } from 'lucide-react';
import type { Festival } from '@/lib/types';
import { Photo } from '@/components/ui/photo';

export function festivalDates(festival: Pick<Festival, 'startsOn' | 'endsOn'>): string {
  const fmt = (iso: string) => new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${fmt(festival.startsOn)} – ${fmt(festival.endsOn)}`;
}

/** A festival on now (or soon) in the diner's city, front and centre on home. */
export function FestivalBanner({ festival }: { festival: Festival }) {
  return (
    <Link href={`/festivals/${festival.slug}`} className="group block">
      <Photo src={festival.coverUrl} alt="" sizes="(max-width: 1024px) 100vw, 1200px" className="rounded-[28px] sm:aspect-[16/5]">
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950/95 via-ink-950/70 to-ink-950/10" />
        <div className="relative flex min-h-[220px] flex-col justify-end p-6 text-white sm:absolute sm:inset-0 sm:p-8">
          <p className="eyebrow flex items-center gap-1.5 text-amber-300">
            <PartyPopper className="h-3.5 w-3.5" /> {festival.phase === 'on' ? 'On now' : 'Coming up'} · {festivalDates(festival)}
          </p>
          <h2 className="mt-2 max-w-xl text-2xl font-black tracking-tight sm:text-4xl">{festival.title}</h2>
          {festival.tagline && <p className="mt-1 max-w-lg text-sm text-white/80 sm:text-base">{festival.tagline}</p>}
          <span className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-ink-900 transition group-hover:gap-2.5">
            {festival.participants} restaurants · See the deals <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </Photo>
    </Link>
  );
}
