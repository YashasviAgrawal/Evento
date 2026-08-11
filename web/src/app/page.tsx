import Image from 'next/image';
import Link from 'next/link';
import * as Icons from 'lucide-react';
import { ArrowRight, Flame, PartyPopper, Sparkles, TicketCheck } from 'lucide-react';
import { fetchPublic } from '@/lib/api';
import type { HomeFeed } from '@/lib/types';
import { EventCard } from '@/components/events/event-card';
import { Hero } from '@/components/home/hero';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/index';

export const revalidate = 30;

/** Categories come from the database with a lucide icon name; resolve it safely. */
function CategoryIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name]) || Icons.Tag;
  return <Icon className={className} />;
}

export default async function HomePage() {
  const feed = await fetchPublic<HomeFeed>('/events/home');

  if (!feed) {
    return (
      <div className="container-page py-20">
        <EmptyState
          icon={<TicketCheck className="h-10 w-10" />}
          title="We can’t reach the events service right now"
          description="Make sure the API is running on port 4000, then refresh this page."
          action={<ButtonLink href="/">Try again</ButtonLink>}
        />
      </div>
    );
  }

  const totalEvents = feed.categories.reduce((sum, category) => sum + (category.eventCount ?? 0), 0);

  return (
    <>
      <Hero cities={feed.popularCities} stats={{ events: totalEvents, cities: feed.popularCities.length }} />

      {/* ── Categories ── */}
      <section className="container-page py-12">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink-900">Browse by category</h2>
            <p className="mt-1 text-sm text-ink-500">Find exactly the kind of night you’re after</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {feed.categories.slice(0, 10).map((category) => (
            <Link
              key={category.id}
              href={`/events?category=${category.slug}`}
              className="group flex flex-col items-center gap-3 rounded-xl border border-ink-200 bg-white p-5 text-center shadow-card transition hover:-translate-y-0.5 hover:border-transparent hover:shadow-lift"
            >
              <span
                className="grid h-12 w-12 place-items-center rounded-xl transition group-hover:scale-110"
                style={{ backgroundColor: `${category.color}18`, color: category.color }}
              >
                <CategoryIcon name={category.icon} className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">{category.name}</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {category.eventCount ?? 0} {category.eventCount === 1 ? 'event' : 'events'}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Trending ── */}
      <EventRail
        title="Trending now"
        description="What everyone is booking this week"
        icon={<Flame className="h-5 w-5 text-brand-600" />}
        href="/events?sort=popular"
        events={feed.trending}
        priority
      />

      {/* ── Featured ── */}
      {feed.featured.length > 0 && (
        <section className="bg-ink-950 py-14">
          <div className="container-page">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
                  <Sparkles className="h-5 w-5 text-brand-500" aria-hidden />
                  Featured events
                </h2>
                <p className="mt-1 text-sm text-ink-400">Hand-picked by our editors</p>
              </div>
              <Link
                href="/events?featured=true"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-400 hover:text-brand-300"
              >
                See all <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {feed.featured.slice(0, 3).map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Upcoming ── */}
      <EventRail
        title="Upcoming events"
        description="Coming up soon near you"
        icon={<TicketCheck className="h-5 w-5 text-brand-600" />}
        href="/events?sort=date"
        events={feed.upcoming}
      />

      {/* ── Popular cities ── */}
      <section className="container-page py-12">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight text-ink-900">Popular cities</h2>
          <p className="mt-1 text-sm text-ink-500">Explore what’s on where you are</p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {feed.popularCities.map((city) => (
            <Link
              key={city.id}
              href={`/events?city=${city.slug}`}
              className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-ink-800"
            >
              {city.imageUrl && (
                <Image
                  src={city.imageUrl}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 50vw, 20vw"
                  className="object-cover opacity-70 transition duration-500 group-hover:scale-110 group-hover:opacity-90"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-3.5">
                <p className="text-sm font-bold text-white">{city.name}</p>
                <p className="text-xs text-ink-300">{city.eventCount ?? 0} events</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Free events ── */}
      {feed.freeEvents.length > 0 && (
        <EventRail
          title="Free to attend"
          description="Great nights out that cost nothing"
          icon={<PartyPopper className="h-5 w-5 text-emerald-600" />}
          href="/events?price=free"
          events={feed.freeEvents}
        />
      )}

      {/* ── Organizer CTA ── */}
      <section className="container-page pb-16 pt-6">
        <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-12 text-center sm:px-12">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Running an event?</h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-brand-100 sm:text-base">
            List it on Evento in minutes. Set up ticket tiers, track sales in real time, and scan QR tickets at the
            door — all from one dashboard.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/organizer/register" size="lg" className="bg-white text-brand-700 hover:bg-brand-50">
              Start selling tickets
            </ButtonLink>
            <ButtonLink
              href="/organizer"
              size="lg"
              variant="outline"
              className="border-white/40 bg-transparent text-white hover:bg-white/10"
            >
              Organizer dashboard
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}

function EventRail({
  title,
  description,
  icon,
  href,
  events,
  priority,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  events: HomeFeed['trending'];
  priority?: boolean;
}) {
  if (events.length === 0) return null;

  return (
    <section className="container-page py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink-900">
            {icon}
            {title}
          </h2>
          <p className="mt-1 text-sm text-ink-500">{description}</p>
        </div>
        <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
          View all <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {events.slice(0, 4).map((event, index) => (
          <EventCard key={event.id} event={event} priority={priority && index < 2} />
        ))}
      </div>
    </section>
  );
}
