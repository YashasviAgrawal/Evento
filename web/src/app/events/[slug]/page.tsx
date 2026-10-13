import type { Metadata } from 'next';
import { fetchPublic } from '@/lib/api';
import type { EventCard as EventCardType, EventDetail } from '@/lib/types';
import { EventDetailView } from '@/components/events/event-detail-view';
import { EventPreview } from '@/components/events/event-preview';
import { formatEventDate } from '@/lib/format';

export const revalidate = 20;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002').replace(/\/$/, '');

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await fetchPublic<EventDetail>(`/events/${slug}`);
  if (!event) return { title: 'Event not found', robots: { index: false, follow: false } };

  const description = event.subtitle ?? event.description.slice(0, 155);
  const canonical = `/events/${event.slug}`;
  const title = `${event.title} — ${formatEventDate(event.startsAt)}, ${event.city.name}`;

  return {
    title,
    description,
    keywords: [event.title, event.category.name, event.city.name, event.venue.name, ...event.tags],
    alternates: { canonical },
    openGraph: {
      title: event.title,
      description,
      url: canonical,
      images: event.bannerUrl ? [{ url: event.bannerUrl, width: 1200, height: 630 }] : undefined,
      type: 'website',
    },
    twitter: {
      card: event.bannerUrl ? 'summary_large_image' : 'summary',
      title: event.title,
      description,
      images: event.bannerUrl ? [event.bannerUrl] : undefined,
    },
  };
}

export default async function EventDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await fetchPublic<EventDetail>(`/events/${slug}`);
  // The server fetch is anonymous, so an unpublished event 404s here. Retry
  // from the browser, where the organizer's or admin's token is available.
  if (!event) return <EventPreview slug={slug} />;

  // Fetch a few related events in the same category to fill the tail.
  const related = await fetchPublic<EventCardType[]>('/events', {
    category: event.category.slug,
    limit: 4,
  });
  const relatedEvents = (related ?? []).filter((item) => item.id !== event.id).slice(0, 3);

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
      url: `${SITE_URL}/events/${event.slug}`,
    })),
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Events', item: `${SITE_URL}/events` },
      {
        '@type': 'ListItem',
        position: 3,
        name: event.category.name,
        item: `${SITE_URL}/events?category=${event.category.slug}`,
      },
      { '@type': 'ListItem', position: 4, name: event.title, item: `${SITE_URL}/events/${event.slug}` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <EventDetailView event={event} relatedEvents={relatedEvents} />
    </>
  );
}
