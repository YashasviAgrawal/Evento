'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Check, Eye, Search, Star, X } from 'lucide-react';
import { api, ApiError, type PageMeta } from '@/lib/api';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { EmptyState, Field, Input, Skeleton, StatusBadge, Textarea } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { cn, formatEventDateTime, formatMoney, formatNumber } from '@/lib/format';

interface AdminEvent {
  id: string;
  title: string;
  slug: string;
  status: string;
  startsAt: string;
  isFeatured: boolean;
  submittedAt: string | null;
  capacity: number;
  ticketsSold: number;
  minPricePaise: number;
  bannerUrl: string | null;
  rejectionReason: string | null;
  category: string;
  city: string;
  organizer: { id: string; name: string; status: string };
}

const TABS = [
  { key: 'pending_review', label: 'Pending review' },
  { key: 'published', label: 'Live' },
  { key: 'draft', label: 'Drafts' },
  { key: 'rejected', label: 'Rejected' },
  { key: '', label: 'All' },
];

export default function AdminEventsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <EventModeration />
    </Suspense>
  );
}

function EventModeration() {
  const searchParams = useSearchParams();
  const toast = useToast();

  const [status, setStatus] = useState(searchParams.get('status') ?? 'pending_review');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<AdminEvent[]>('/admin/events', {
        query: { status: status || undefined, q: debounced || undefined, page, limit: 20 },
      });
      setEvents(response.data);
      setMeta(response.meta ?? null);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [status, debounced, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    try {
      await api.post(`/admin/events/${id}/approve`);
      toast.success('Event approved', 'It is now live and bookable.');
      await load();
    } catch (err) {
      toast.error('Could not approve', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (reason.trim().length < 5) {
      toast.error('Add a reason', 'Explain what the organizer needs to change.');
      return;
    }
    setBusyId(id);
    try {
      await api.post(`/admin/events/${id}/reject`, { reason: reason.trim() });
      toast.success('Event rejected', 'The organizer has been notified.');
      setRejecting(null);
      setReason('');
      await load();
    } catch (err) {
      toast.error('Could not reject', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleFeatured(event: AdminEvent) {
    try {
      await api.post(`/admin/events/${event.id}/feature`, { featured: !event.isFeatured });
      toast.success(event.isFeatured ? 'Removed from featured' : 'Added to featured');
      await load();
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <div>
      <PageHeader title="Event approvals" description="Review submissions and manage what's live on the platform" />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setStatus(tab.key);
                setPage(1);
              }}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition',
                status === tab.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events or organizers"
            className="pl-9"
            aria-label="Search events"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<Check className="h-9 w-9" />}
          title={status === 'pending_review' ? 'Nothing awaiting review' : 'No events found'}
          description={status === 'pending_review' ? 'You’re all caught up.' : 'Try a different filter.'}
        />
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-lg bg-ink-100 sm:h-20 sm:w-32">
                  {event.bannerUrl && (
                    <Image src={event.bannerUrl} alt="" fill sizes="128px" className="object-cover" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-ink-900">{event.title}</h2>
                    <StatusBadge status={event.status} />
                    {event.isFeatured && (
                      <span className="badge bg-brand-50 text-brand-700 ring-brand-200">
                        <Star className="h-3 w-3" aria-hidden />
                        Featured
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-ink-500">
                    {formatEventDateTime(event.startsAt)} · {event.city} · {event.category}
                  </p>

                  <p className="mt-1 text-sm text-ink-600">
                    by <span className="font-medium text-ink-900">{event.organizer.name}</span>
                    <StatusBadge status={event.organizer.status} className="ml-2" />
                  </p>

                  <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-500">
                    <span>{formatNumber(event.capacity)} capacity</span>
                    <span>{formatNumber(event.ticketsSold)} sold</span>
                    <span>From {formatMoney(event.minPricePaise)}</span>
                    {event.submittedAt && <span>Submitted {formatEventDateTime(event.submittedAt)}</span>}
                  </div>

                  {event.rejectionReason && (
                    <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      <span className="font-semibold">Rejected:</span> {event.rejectionReason}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-start gap-2">
                  <Link
                    href={`/events/${event.slug}`}
                    target="_blank"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-300 px-3 text-xs font-medium text-ink-700 transition hover:bg-ink-50"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </Link>

                  {event.status === 'published' && (
                    <Button variant="outline" size="sm" onClick={() => toggleFeatured(event)}>
                      <Star className={cn('h-3.5 w-3.5', event.isFeatured && 'fill-brand-500 text-brand-500')} />
                      {event.isFeatured ? 'Unfeature' : 'Feature'}
                    </Button>
                  )}

                  {['pending_review', 'rejected', 'paused'].includes(event.status) && (
                    <Button variant="success" size="sm" onClick={() => approve(event.id)} loading={busyId === event.id}>
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </Button>
                  )}

                  {event.status === 'pending_review' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-rose-300 text-rose-700 hover:bg-rose-50"
                      onClick={() => {
                        setRejecting(rejecting === event.id ? null : event.id);
                        setReason('');
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </Button>
                  )}
                </div>
              </div>

              {rejecting === event.id && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4">
                  <Field label="Why is this being rejected?" hint="The organizer sees this message in their email">
                    <Textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      placeholder="The banner image is low resolution and the venue address is incomplete…"
                      autoFocus
                    />
                  </Field>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => reject(event.id)}
                      loading={busyId === event.id}
                      disabled={reason.trim().length < 5}
                    >
                      Send rejection
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRejecting(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-ink-500">
                Page {meta.page} of {meta.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
