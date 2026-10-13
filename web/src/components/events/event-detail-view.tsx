import Image from 'next/image';
import Link from 'next/link';
import {
  Building2,
  CalendarDays,
  Clock,
  Info,
  Languages,
  MapPin,
  ShieldCheck,
  Tag,
  Users,
} from 'lucide-react';
import type { EventCard as EventCardType, EventDetail } from '@/lib/types';
import { TicketSelector } from '@/components/events/ticket-selector';
import { ShareButton } from '@/components/events/share-button';
import { AddToCalendar } from '@/components/events/add-to-calendar';
import { EventCard } from '@/components/events/event-card';
import { Badge, StatusBadge } from '@/components/ui/index';
import { formatEventDate, formatEventDateTime, formatEventTime, formatNumber, priceLabel } from '@/lib/format';

/**
 * The event detail markup, shared by the server-rendered public page and the
 * client-rendered preview an organizer or admin sees for unpublished events.
 */
export function EventDetailView({ event, relatedEvents }: { event: EventDetail; relatedEvents: EventCardType[] }) {
  const mapQuery =
    event.venue.latitude && event.venue.longitude
      ? `${event.venue.latitude},${event.venue.longitude}`
      : encodeURIComponent(`${event.venue.name}, ${event.venue.addressLine1}, ${event.city.name}`);

  return (
    <>
      {/* ── Banner ──
          The image keeps its own shape and is never cropped: a wide banner
          fills the width, a tall poster is height-capped and centred. Any
          leftover space shows a dimmed copy of the same image behind it. */}
      {event.bannerUrl && (
        <div className="container-page pt-3 sm:pt-6">
          <div className="relative overflow-hidden rounded-xl bg-ink-950 sm:rounded-2xl">
            <Image
              src={event.bannerUrl}
              alt=""
              aria-hidden
              fill
              sizes="100vw"
              className="scale-105 object-cover blur-sm brightness-[0.35]"
            />
            <Image
              src={event.bannerUrl}
              alt={event.title}
              width={0}
              height={0}
              priority
              sizes="(min-width: 1280px) 1200px, 100vw"
              className="relative h-auto max-h-[75vh] w-full object-contain lg:max-h-[28rem]"
            />
          </div>
        </div>
      )}

      <div className="container-page py-6 lg:py-8">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-500">
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

        <header className="mb-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{event.category.name}</Badge>
            {event.subcategory && (
              <Link href={`/events?category=${event.category.slug}&subcategory=${event.subcategory.slug}`}>
                <Badge className="transition hover:bg-ink-200">{event.subcategory.name}</Badge>
              </Link>
            )}
            {event.isFeatured && <span className="badge bg-brand-600 text-white ring-brand-500">Featured</span>}
            {event.status !== 'published' && <StatusBadge status={event.status} />}
          </div>

          <h1 className="mt-3 max-w-3xl text-2xl font-extrabold leading-tight tracking-tight text-ink-900 sm:text-4xl">
            {event.title}
          </h1>
          {event.subtitle && <p className="mt-2 max-w-2xl text-sm text-ink-600 sm:text-base">{event.subtitle}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-600">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-brand-600" aria-hidden />
              {formatEventDate(event.startsAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-brand-600" aria-hidden />
              {formatEventTime(event.startsAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-brand-600" aria-hidden />
              {event.venue.name}, {event.city.name}
            </span>
          </div>
        </header>

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
            <div className="mb-4 flex flex-wrap gap-2">
              <ShareButton
                title={event.title}
                text={`${formatEventDate(event.startsAt)} at ${event.venue.name}, ${event.city.name}`}
              />
              <AddToCalendar
                event={{
                  title: event.title,
                  description: event.subtitle ?? undefined,
                  location: `${event.venue.name}, ${event.venue.addressLine1}, ${event.city.name}`,
                  startsAt: event.startsAt,
                  endsAt: event.endsAt,
                }}
                filename={`${event.slug}.ics`}
              />
            </div>

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
