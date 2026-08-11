'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/shell';
import { EventForm } from '@/components/organizer/event-form';

export default function NewEventPage() {
  return (
    <div>
      <Link
        href="/organizer/events"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to events
      </Link>

      <PageHeader
        title="Create an event"
        description="Fill in the details below. You can keep editing before submitting it for review."
      />

      <EventForm />
    </div>
  );
}
