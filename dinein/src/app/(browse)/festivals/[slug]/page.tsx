import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarDays, MapPin, PartyPopper } from 'lucide-react';
import { fetchPublic } from '@tixit/session';
import type { FestivalPage } from '@/lib/types';
import { Photo } from '@/components/ui/photo';
import { RatingPill } from '@/components/restaurant/bits';
import { festivalDates } from '@/components/restaurant/festival-banner';
import { rupees } from '@/lib/format';

type Props = { params: Promise<{ slug: string }> };
const load = (slug: string) => fetchPublic<FestivalPage>(`/dining/festivals/${slug}`, undefined, 120);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const festival = await load((await params).slug);
  return { title: festival?.title ?? 'Festival', description: festival?.tagline ?? undefined };
}

const APPLIES: Record<string, string> = { prebook: 'when you pre-book', walkin: 'for walk-ins', both: 'pre-book or walk in' };

export default async function FestivalRoute({ params }: Props) {
  const festival = await load((await params).slug);
  if (!festival) notFound();

  return (
    <>
      <Photo src={festival.coverUrl} alt="" priority className="h-72 sm:h-96">
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/95 via-ink-950/40 to-transparent" />
        <div className="container-page absolute inset-x-0 bottom-6 text-white">
          <p className="eyebrow flex items-center gap-1.5 text-amber-300">
            <PartyPopper className="h-3.5 w-3.5" />
            {festival.phase === 'on' ? 'On now' : festival.phase === 'upcoming' ? 'Coming up' : 'This festival has ended'}
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-5xl">{festival.title}</h1>
          {festival.tagline && <p className="mt-2 max-w-xl text-white/80">{festival.tagline}</p>}
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/80">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" /> {festivalDates(festival)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" /> {festival.city.name}
            </span>
          </p>
        </div>
      </Photo>

      <div className="container-page py-8">
        {festival.description && <p className="max-w-2xl text-[15px] leading-relaxed text-ink-700">{festival.description}</p>}
        <p className="mt-2 text-sm text-ink-500">Festival deals apply on their own when you pay the bill on Tixit — no code needed.</p>

        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {festival.restaurants.map(({ card, highlight, deal }) => (
            <li key={card.id}>
              <Link href={`/r/${card.slug}`} className="press group block overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200 transition hover:shadow-lift">
                <Photo src={card.coverUrl} alt={card.name} sizes="(max-width: 640px) 100vw, 33vw" className="aspect-[16/10]">
                  <div className="scrim absolute inset-0" />
                  <span className="absolute left-3 top-3 rounded-xl bg-amber-300 px-2.5 py-1 text-sm font-black text-ink-950 shadow-card">
                    {deal.label}
                  </span>
                </Photo>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-extrabold tracking-tight group-hover:text-brand-700">{card.name}</h2>
                    <RatingPill rating={card.rating} />
                  </div>
                  <p className="text-[13px] text-ink-500">
                    {card.locality} · {rupees(card.costForTwoPaise)} for two
                  </p>
                  {highlight && <p className="mt-2 text-sm font-semibold text-ink-800">{highlight}</p>}
                  <p className="mt-1 text-xs text-ink-500">Festival deal {APPLIES[deal.appliesTo] ?? ''}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
