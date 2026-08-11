'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { CalendarPlus, Eye, MoreVertical, Pause, Play, Send, Trash2 } from 'lucide-react';
import { api, ApiError, type PageMeta } from '@/lib/api';
import type { EventCard } from '@/lib/types';
import { PageHeader } from '@/components/dashboard/shell';
import { Button, ButtonLink } from '@/components/ui/button';
import { EmptyState, Skeleton, StatusBadge } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { cn, formatEventDateTime, formatMoney, formatNumber } from '@/lib/format';

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'pending_review', label: 'In review' },
  { key: 'published', label: 'Live' },
  { key: 'paused', label: 'Paused' },
  { key: 'rejected', label: 'Rejected' },
];

export default function OrganizerEventsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <EventsTable />
    </Suspense>
  );
}

function EventsTable() {
  const searchParams = useSearchParams();
  const toast = useToast();

  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [events, setEvents] = useState<EventCard[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<EventCard[]>('/organizer/events', {
        query: { status: status || undefined, page, limit: 20 },
      });
      setEvents(response.data);
      setMeta(response.meta ?? null);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: 'submit' | 'pause' | 'resume' | 'delete') {
    setBusyId(id);
    setMenuId(null);
    try {
      if (action === 'delete') {
        if (!window.confirm('Delete this event? This cannot be undone.')) return;
        await api.delete(`/organizer/events/${id}`);
        toast.success('Event deleted');
      } else {
        await api.post(`/organizer/events/${id}/${action}`);
        toast.success(
          action === 'submit' ? 'Submitted for review' : action === 'pause' ? 'Event paused' : 'Event resumed',
        );
      }
      await load();
    } catch (err) {
      toast.error('Could not complete that', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="My events"
        description="Create, publish and manage your listings"
        actions={
          <ButtonLink href="/organizer/events/new">
            <CalendarPlus className="h-4 w-4" />
            New event
          </ButtonLink>
        }
      />

      <div className="mb-5 flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1">
        {STATUS_TABS.map((tab) => (
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

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<CalendarPlus className="h-9 w-9" />}
          title={status ? 'No events with that status' : 'No events yet'}
          description="Create an event, add ticket tiers, and submit it for approval."
          action={<ButtonLink href="/organizer/events/new">Create your first event</ButtonLink>}
        />
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex flex-col gap-4 rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:flex-row"
            >
              <div className="relative h-28 w-full shrink-0 overflow-hidden rounded-lg bg-ink-100 sm:h-20 sm:w-32">
                {event.thumbnailUrl && (
                  <Image src={event.thumbnailUrl} alt="" fill sizes="128px" className="object-cover" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/organizer/events/${event.id}`}
                    className="text-base font-bold text-ink-900 hover:text-brand-600"
                  >
                    {event.title}
                  </Link>
                  <StatusBadge status={event.status ?? 'draft'} />
                </div>

                <p className="mt-1 text-sm text-ink-500">
                  {formatEventDateTime(event.startsAt)} · {event.venue.name}, {event.city.name}
                </p>

                <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-500">
                  <span>
                    <span className="font-semibold text-ink-900">{formatNumber(event.ticketsSold)}</span> /{' '}
                    {formatNumber(event.totalCapacity)} sold
                  </span>
                  <span>
                    From <span className="font-semibold text-ink-900">{formatMoney(event.minPricePaise)}</span>
                  </span>
                  {event.isFeatured && <span className="font-medium text-brand-600">Featured</span>}
                </div>
              </div>

              <div className="relative flex shrink-0 items-start gap-2">
                <ButtonLink href={`/organizer/events/${event.id}`} variant="outline" size="sm">
                  Manage
                </ButtonLink>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMenuId(menuId === event.id ? null : event.id)}
                  loading={busyId === event.id}
                  aria-label={`Actions for ${event.title}`}
                  aria-expanded={menuId === event.id}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>

                {menuId === event.id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuId(null)} />
                    <div
                      role="menu"
                      className="absolute right-0 top-10 z-20 w-52 animate-fade-up overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-lift"
                    >
                      <MenuItem href={`/events/${event.slug}`} icon={<Eye className="h-4 w-4" />}>
                        View public page
                      </MenuItem>

                      {(event.status === 'draft' || event.status === 'rejected') && (
                        <MenuButton onClick={() => act(event.id, 'submit')} icon={<Send className="h-4 w-4" />}>
                          Submit for review
                        </MenuButton>
                      )}
                      {event.status === 'published' && (
                        <MenuButton onClick={() => act(event.id, 'pause')} icon={<Pause className="h-4 w-4" />}>
                          Pause bookings
                        </MenuButton>
                      )}
                      {event.status === 'paused' && (
                        <MenuButton onClick={() => act(event.id, 'resume')} icon={<Play className="h-4 w-4" />}>
                          Resume bookings
                        </MenuButton>
                      )}

                      <div className="my-1 border-t border-ink-100" />
                      <MenuButton
                        onClick={() => act(event.id, 'delete')}
                        icon={<Trash2 className="h-4 w-4" />}
                        danger
                      >
                        Delete event
                      </MenuButton>
                    </div>
                  </>
                )}
              </div>
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

function MenuItem({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      target="_blank"
      role="menuitem"
      className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-ink-700 transition hover:bg-ink-100"
    >
      <span className="text-ink-400">{icon}</span>
      {children}
    </Link>
  );
}

function MenuButton({
  onClick,
  icon,
  children,
  danger,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className={cn(
        'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition',
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-ink-700 hover:bg-ink-100',
      )}
    >
      <span className={danger ? '' : 'text-ink-400'}>{icon}</span>
      {children}
    </button>
  );
}
