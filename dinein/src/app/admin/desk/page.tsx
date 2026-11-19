'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Inbox } from 'lucide-react';
import { api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import { cn, dateTime, relativeDay } from '@/lib/format';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState, Skeleton } from '@/components/ui/feedback';

interface Grievance {
  id: string;
  reference: string;
  name: string;
  email: string;
  category: string;
  subject: string;
  body: string;
  order_ref: string | null;
  status: string;
  response: string | null;
  due_at: string;
  created_at: string;
}
interface DataRequest {
  id: string;
  reference: string;
  kind: string;
  status: string;
  details: string | null;
  resolution: string | null;
  due_at: string;
  created_at: string;
  full_name: string | null;
  email: string | null;
}

const OPEN = ['open', 'in_progress'];

/** What we already told the person, for either kind of item. */
function answerOf(item: Grievance | DataRequest): string | null {
  return 'subject' in item ? item.response : item.resolution;
}

/** Grievances and data-protection requests, oldest deadline first. */
export default function AdminDeskPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'grievances' | 'requests'>('grievances');
  const [active, setActive] = useState<Grievance | DataRequest | null>(null);
  const [reply, setReply] = useState('');

  const grievances = useQuery({ queryKey: ['admin-grievances'], queryFn: async () => (await api.get<Grievance[]>('/admin/privacy/grievances')).data });
  const requests = useQuery({ queryKey: ['admin-privacy-requests'], queryFn: async () => (await api.get<DataRequest[]>('/admin/privacy/requests')).data });

  const act = useMutation({
    mutationFn: async (status: string) => {
      if (!active) return;
      if ('subject' in active) await api.patch(`/admin/privacy/grievances/${active.id}`, { status, response: reply });
      else await api.patch(`/admin/privacy/requests/${active.id}`, { status, resolution: reply || null });
    },
    onSuccess: () => {
      toast.success('Sent', 'The person has been emailed.');
      setActive(null);
      setReply('');
      void queryClient.invalidateQueries({ queryKey: ['admin-grievances'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-privacy-requests'] });
    },
    onError: (e) => toast.error('Could not update', e instanceof Error ? e.message : undefined),
  });

  const rows = tab === 'grievances' ? grievances.data : requests.data;
  const loading = tab === 'grievances' ? grievances.isLoading : requests.isLoading;
  const overdue = (r: { status: string; due_at: string }) => OPEN.includes(r.status) && new Date(r.due_at).getTime() < Date.now();
  const openCount = (list?: Array<{ status: string }>) => (list ?? []).filter((r) => OPEN.includes(r.status)).length;

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Grievance &amp; privacy desk</h1>
      <p className="text-sm text-ink-500">Complaints and data-protection requests. Each has a statutory deadline.</p>

      <div className="mt-5 inline-flex rounded-full bg-ink-100 p-1 text-sm font-bold">
        {(
          [
            ['grievances', `Grievances · ${openCount(grievances.data)}`],
            ['requests', `Data requests · ${openCount(requests.data)}`],
          ] as const
        ).map(([value, label]) => (
          <button key={value} onClick={() => setTab(value)} className={cn('rounded-full px-4 py-2', tab === value ? 'bg-white shadow-card' : 'text-ink-500')}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-48 rounded-3xl" />
        ) : !rows || rows.length === 0 ? (
          <EmptyState icon={Inbox} title="Nothing here" body="New items appear the moment someone files them." />
        ) : (
          <ul className="divide-y divide-ink-100 overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
            {rows.map((row) => (
              <li key={row.id}>
                <button onClick={() => { setActive(row); setReply(''); }} className="flex w-full items-start gap-3 p-4 text-left hover:bg-ink-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{'subject' in row ? row.subject : `${row.kind} request`}</span>
                    <span className="block text-xs text-ink-500">
                      {row.reference} · {'name' in row ? row.name : row.full_name} · filed {dateTime(row.created_at)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold capitalize', OPEN.includes(row.status) ? 'bg-amber-50 text-amber-700' : 'bg-save-50 text-save-700')}>
                      {row.status.replace('_', ' ')}
                    </span>
                    {OPEN.includes(row.status) && (
                      <span className={cn('flex items-center gap-1 text-[11px] font-semibold', overdue(row) ? 'text-rose-600' : 'text-ink-500')}>
                        <AlarmClock className="h-3 w-3" /> {overdue(row) ? 'Overdue' : `Due ${relativeDay(row.due_at).toLowerCase()}`}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Sheet
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title={active ? ('subject' in active ? active.subject : `${active.kind} request`) : ''}
        subtitle={active ? `${active.reference} · ${'email' in active ? active.email : ''}` : undefined}
        footer={
          active && OPEN.includes(active.status) ? (
            <div className="flex gap-2 pb-1">
              <button onClick={() => act.mutate('in_progress')} disabled={act.isPending || ('subject' in active && reply.length < 2)} className="press h-12 flex-1 rounded-2xl font-bold ring-1 ring-inset ring-ink-300 disabled:opacity-50">
                Update
              </button>
              {'subject' in active ? (
                <button onClick={() => act.mutate('resolved')} disabled={act.isPending || reply.length < 2} className="press h-12 flex-[1.4] rounded-2xl bg-save-600 font-bold text-white disabled:opacity-50">
                  Resolve
                </button>
              ) : (
                <>
                  <button onClick={() => act.mutate('rejected')} disabled={act.isPending} className="press h-12 flex-1 rounded-2xl font-bold text-rose-700 ring-1 ring-inset ring-rose-200">
                    Reject
                  </button>
                  <button onClick={() => act.mutate('completed')} disabled={act.isPending} className={cn('press h-12 flex-[1.4] rounded-2xl font-bold text-white', active.kind === 'erasure' ? 'bg-rose-600' : 'bg-save-600')}>
                    {active.kind === 'erasure' ? 'Erase account' : 'Complete'}
                  </button>
                </>
              )}
            </div>
          ) : undefined
        }
      >
        {active && (
          <div className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap rounded-2xl bg-ink-50 p-3 text-ink-700">{'body' in active ? active.body : active.details || 'No details given.'}</p>
            {'order_ref' in active && active.order_ref && <p className="text-xs text-ink-500">Order: {active.order_ref}</p>}
            {answerOf(active) && <p className="rounded-2xl bg-save-50 p-3 text-save-800">{answerOf(active)}</p>}
            {OPEN.includes(active.status) && (
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={5}
                className="input resize-none"
                placeholder={'subject' in active ? 'Your response to the person (emailed to them)' : 'Note to the person (optional)'}
              />
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
