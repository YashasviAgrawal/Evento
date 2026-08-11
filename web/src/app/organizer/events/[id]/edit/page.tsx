'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/shell';
import { EventForm } from '@/components/organizer/event-form';

export default function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <div>
      <Link
        href={`/organizer/events/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to event
      </Link>

      <PageHeader title="Edit event" description="Update the listing. Ticket tiers are managed on the event page." />

      <EventForm eventId={id} />
    </div>
  );
}
