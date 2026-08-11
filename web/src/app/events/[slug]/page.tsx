import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  Building2,
  CalendarDays,
  Clock,
  Globe,
  Info,
  Languages,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Tag,
  Users,
} from 'lucide-react';
import { fetchPublic } from '@/lib/api';
import type { EventCard as EventCardType, EventDetail } from '@/lib/types';
import { TicketSelector } from '@/components/events/ticket-selector';
import { EventCard } from '@/components/events/event-card';
import { Badge, StatusBadge } from '@/components/ui/index';
import { formatEventDate, formatEventDateTime, formatEventTime, formatNumber, priceLabel } from '@/lib/format';

export const revalidate = 20;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await fetchPublic<EventDetail>(`/events/${slug}`);
  if (!event) return { title: 'Event not found' };

  return {
    title: event.title,
    description: event.subtitle ?? event.description.slice(0, 155),
    openGraph: {
      title: event.title,
      description: event.subtitle ?? event.description.slice(0, 155),
      images: event.bannerUrl ? [{ url: event.bannerUrl }] : undefined,
      type: 'website',
    },
  };
}

export default async function EventDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await fetchPublic<EventDetail>(`/events/${slug}`);
  if (!event) notFound();

  // Fetch a few related events in the same category to fill the tail.
  const related = await fetchPublic<EventCardType[]>('/events', {
    category: event.category.slug,
    limit: 4,
  });
  const relatedEvents = (related ?? []).filter((item) => item.id !== event.id).slice(0, 3);

  const mapQuery =
    event.venue.latitude && event.venue.longitude
      ? `${event.venue.latitude},${event.venue.longitude}`
      : encodeURIComponent(`${event.venue.name}, ${event.venue.addressLine1}, ${event.city.name}`);

  /** Structured data helps the listing surface correctly in search results. */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.subtitle ?? event.description.slice(0, 300),
    startDate: event.startsAt,
    endDate: event.endsAt,
    eventStatus: `https://schema.org/Event${event.status === 'cancelled' ? 'Cancelled' : 'Scheduled'}`,
    image: event.bannerUrl ? [event.bannerUrl] : undefined,
    location: {
      '@type': 'Place',
      name: event.venue.name,
      address: {
        '@type': 'PostalAddress',
        streetAddress: event.venue.addressLine1,
        addressLocality: event.city.name,
        addressRegion: event.city.state,
        postalCode: event.venue.postalCode ?? undefined,
        addressCountry: 'IN',
      },
    },
    organizer: { '@type': 'Organization', name: event.organizer.name },
    offers: event.ticketTypes.map((tier) => ({
      '@type': 'Offer',
      name: tier.name,
      price: (tier.pricePaise / 100).toFixed(2),
      priceCurrency: 'INR',
      availability: tier.available > 0 ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* ── Banner ── */}
      <div className="relative h-64 w-full overflow-hidden bg-ink-900 sm:h-80 lg:h-[26rem]">
        {event.bannerUrl && (
          <Image src={event.bannerUrl} alt="" fill priority sizes="100vw" className="object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/60 to-ink-950/20" />

        <div className="container-page absolute inset-x-0 bottom-0 pb-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-white/95 text-ink-900 ring-white/30">{event.category.name}</span>
            {event.isFeatured && <span className="badge bg-brand-600 text-white ring-brand-500">Featured</span>}
            {event.status !== 'published' && <StatusBadge status={event.status} />}
          </div>

          <h1 className="mt-3 max-w-3xl text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
            {event.title}
          </h1>
          {event.subtitle && <p className="mt-2 max-w-2xl text-sm text-ink-200 sm:text-base">{event.subtitle}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-200">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" aria-hidden />
              {formatEventDate(event.startsAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" aria-hidden />
              {formatEventTime(event.startsAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden />
              {event.venue.name}, {event.city.name}
            </span>
          </div>
        </div>
      </div>

      <div className="container-page py-8 lg:py-10">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-ink-500">
          <Link href="/" className="hover:text-ink-800">
            Home
          </Link>
          <span className="mx-1.5">/</span>
          <Link href="/events" className="hover:text-ink-800">
            Events
          </Link>
          <span className="mx-1.5">/</span>
          <Link href={`/events?category=${event.category.slug}`} className="hover:text-ink-800">
            {event.category.name}
          </Link>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          {/* ── Main column ── */}
          <div className="min-w-0 space-y-8">
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat icon={<CalendarDays className="h-4 w-4" />} label="Date" value={formatEventDate(event.startsAt)} />
              <Stat
                icon={<Clock className="h-4 w-4" />}
                label="Duration"
                value={event.durationMinutes ? `${Math.round(event.durationMinutes / 60)} hours` : '—'}
              />
              <Stat icon={<Languages className="h-4 w-4" />} label="Language" value={event.language} />
              <Stat
                icon={<Users className="h-4 w-4" />}
                label="Age limit"
                value={event.ageLimit ? `${event.ageLimit}+` : 'All ages'}
              />
            </section>

            <section>
              <h2 className="mb-3 text-lg font-bold text-ink-900">About this event</h2>
              <div className="space-y-3 text-sm leading-relaxed text-ink-700">
                {event.description.split('\n').filter(Boolean).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>

              {event.tags.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {event.tags.map((tag) => (
                    <Link key={tag} href={`/events?tag=${encodeURIComponent(tag)}`}>
                      <Badge className="transition hover:bg-ink-200">
                        <Tag className="h-3 w-3" aria-hidden />
                        {tag}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* ── Venue + map ── */}
            <section>
              <h2 className="mb-3 text-lg font-bold text-ink-900">Venue</h2>
              <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
                <div className="p-5">
                  <p className="flex items-start gap-2.5">
                    <Building2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-brand-600" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold text-ink-900">{event.venue.name}</span>
                      <span className="mt-0.5 block text-sm text-ink-600">
                        {event.venue.addressLine1}
                        {event.venue.addressLine2 && `, ${event.venue.addressLine2}`}
                        <br />
                        {event.city.name}, {event.city.state}
                        {event.venue.postalCode && ` — ${event.venue.postalCode}`}
                      </span>
                      {event.venue.landmark && (
                        <span className="mt-1 block text-xs text-ink-500">Near {event.venue.landmark}</span>
                      )}
                    </span>
                  </p>

                  <a
                    href={
                      event.venue.googleMapsUrl ??
                      `https://www.google.com/maps/search/?api=1&query=${mapQuery}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
                  >
                    <MapPin className="h-4 w-4" aria-hidden />
                    Open in Google Maps
                  </a>
                </div>

                {/* Embedded map needs no API key in this mode. */}
                <iframe
                  title={`Map showing ${event.venue.name}`}
                  src={`https://maps.google.com/maps?q=${mapQuery}&z=15&output=embed`}
                  className="h-64 w-full border-0 border-t border-ink-200"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </section>

            {/* ── Organizer ── */}
            <section>
              <h2 className="mb-3 text-lg font-bold text-ink-900">Organizer</h2>
              <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
                <div className="flex items-start gap-4">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-lg font-bold text-brand-700">
                    {event.organizer.name.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-ink-900">{event.organizer.name}</h3>
                      {event.organizer.status === 'verified' && (
                        <Badge tone="success">
                          <ShieldCheck className="h-3 w-3" aria-hidden />
                          Verified
                        </Badge>
                      )}
                    </div>
                    {event.organizer.bio && <p className="mt-1.5 text-sm text-ink-600">{event.organizer.bio}</p>}

                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-500">
                      {event.organizer.email && (
                        <a href={`mailto:${event.organizer.email}`} className="flex items-center gap-1.5 hover:text-brand-600">
                          <Mail className="h-3.5 w-3.5" aria-hidden />
                          {event.organizer.email}
                        </a>
                      )}
                      {event.organizer.phone && (
                        <a href={`tel:${event.organizer.phone}`} className="flex items-center gap-1.5 hover:text-brand-600">
                          <Phone className="h-3.5 w-3.5" aria-hidden />
                          {event.organizer.phone}
                        </a>
                      )}
                      {event.organizer.website && (
                        <a
                          href={event.organizer.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 hover:text-brand-600"
                        >
                          <Globe className="h-3.5 w-3.5" aria-hidden />
                          Website
                        </a>
                      )}
                    </div>

                    <Link
                      href={`/events?organizer=${event.organizer.slug}`}
                      className="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      See all events by this organizer →
                    </Link>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Terms ── */}
            {event.terms && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-ink-900">
                  <Info className="h-4.5 w-4.5 text-ink-400" aria-hidden />
                  Terms &amp; conditions
                </h2>
                <div className="rounded-xl border border-ink-200 bg-white p-5 text-sm leading-relaxed text-ink-600 shadow-card">
                  {event.terms}
                </div>
              </section>
            )}
          </div>

          {/* ── Sticky booking column ── */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="mb-4 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Starting from</p>
              <p className="mt-1 text-2xl font-extrabold text-ink-900">
                {priceLabel(event.minPricePaise, event.maxPricePaise, event.isFree)}
              </p>
              <p className="mt-1.5 text-xs text-ink-500">
                {formatEventDateTime(event.startsAt)}
                {event.doorsOpenAt && ` · Doors open ${formatEventTime(event.doorsOpenAt)}`}
              </p>
              {event.totalCapacity > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-ink-500">
                    <span>{formatNumber(event.ticketsSold)} booked</span>
                    <span>{formatNumber(Math.max(0, event.totalCapacity - event.ticketsSold))} left</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-full rounded-full bg-brand-600 transition-all"
                      style={{
                        width: `${Math.min(100, (event.ticketsSold / event.totalCapacity) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <TicketSelector event={event} />
          </div>
        </div>

        {/* ── Related ── */}
        {relatedEvents.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-5 text-xl font-bold tracking-tight text-ink-900">You might also like</h2>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {relatedEvents.map((item) => (
                <EventCard key={item.id} event={item} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3.5 shadow-card">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
        <span className="text-brand-600">{icon}</span>
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-ink-900">{value}</p>
    </div>
  );
}
