'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import type { EventDetail } from '@/lib/types';
import { EventDetailView } from '@/components/events/event-detail-view';
import { DetailPageLoading } from '@/components/ui/page-loading';

/**
 * Client-side fallback for an event the anonymous server render could not
 * load. The API shows unpublished events to their organizer and to admins,
 * but only the browser holds their access token, so the fetch happens here.
 */
export function EventPreview({ slug }: { slug: string }) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api
      .get<EventDetail>(`/events/${slug}`)
      .then(({ data }) => setEvent(data))
      .catch(() => setMissing(true));
  }, [slug]);

  if (missing) notFound();
  if (!event) return <DetailPageLoading />;
  return <EventDetailView event={event} relatedEvents={[]} />;
}
