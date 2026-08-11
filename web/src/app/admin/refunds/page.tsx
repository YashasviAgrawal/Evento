'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, RotateCcw, X } from 'lucide-react';
import { api, ApiError, type PageMeta } from '@/lib/api';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { EmptyState, Field, Skeleton, StatusBadge, Textarea } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { cn, formatDateTime, formatMoney } from '@/lib/format';

interface RefundRequest {
  id: string;
  amountPaise: number;
  reason: string;
  status: string;
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  processedAt: string | null;
  booking: {
    id: string;
    code: string;
    customerName: string;
    customerEmail: string;
    totalPaise: number;
  };
  eventTitle: string;
}

const TABS = [
  { key: 'requested', label: 'Pending' },
  { key: 'processed', label: 'Processed' },
  { key: 'rejected', label: 'Rejected' },
  { key: '', label: 'All' },
];

export default function AdminRefundsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <RefundsQueue />
    </Suspense>
  );
}

function RefundsQueue() {
  const searchParams = useSearchParams();
  const toast = useToast();

  const [status, setStatus] = useState(searchParams.get('status') ?? 'requested');
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<RefundRequest[]>('/admin/refunds', {
        query: { status: status || undefined, page, limit: 20 },
      });
      setRefunds(response.data);
      setMeta(response.meta ?? null);
    } catch {
      setRefunds([]);
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(id: string, action: 'approve' | 'reject') {
    if (action === 'reject' && note.trim().length < 3) {
      toast.error('Add a note', 'Explain why this refund is being declined.');
      return;
    }

    setBusyId(id);
    try {
      await api.post(`/admin/refunds/${id}/${action}`, { note: note.trim() || undefined });
      toast.success(
        action === 'approve' ? 'Refund approved and sent to the gateway' : 'Refund rejected',
      );
      setNoteFor(null);
      setNote('');
      await load();
    } catch (err) {
      toast.error('Could not complete that', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Refunds" description="Review and approve customer refund requests" />

      <div className="mb-5 flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1">
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

      {loading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : refunds.length === 0 ? (
        <EmptyState
          icon={<RotateCcw className="h-9 w-9" />}
          title={status === 'requested' ? 'No refund requests pending' : 'No refunds found'}
          description={status === 'requested' ? 'You’re all caught up.' : undefined}
        />
      ) : (
        <div className="space-y-3">
          {refunds.map((refund) => (
            <div key={refund.id} className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-extrabold text-ink-900">{formatMoney(refund.amountPaise)}</span>
                    <StatusBadge status={refund.status} />
                    <span className="font-mono text-xs text-ink-500">{refund.booking.code}</span>
                  </div>

                  <p className="mt-1.5 text-sm text-ink-700">{refund.eventTitle}</p>
                  <p className="text-sm text-ink-500">
                    {refund.booking.customerName} · {refund.booking.customerEmail}
                  </p>

                  <p className="mt-2.5 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
                    <span className="font-semibold">Reason:</span> {refund.reason}
                  </p>

                  {refund.adminNote && (
                    <p className="mt-2 text-xs text-ink-500">
                      <span className="font-semibold">Admin note:</span> {refund.adminNote}
                    </p>
                  )}

                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                    <span>Requested {formatDateTime(refund.createdAt)}</span>
                    {refund.reviewedAt && <span>Reviewed {formatDateTime(refund.reviewedAt)}</span>}
                    {refund.processedAt && <span>Processed {formatDateTime(refund.processedAt)}</span>}
                    <span>Booking total {formatMoney(refund.booking.totalPaise)}</span>
                  </div>
                </div>

                {refund.status === 'requested' && (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => setNoteFor({ id: refund.id, action: 'approve' })}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-rose-300 text-rose-700 hover:bg-rose-50"
                      onClick={() => setNoteFor({ id: refund.id, action: 'reject' })}
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </Button>
                  </div>
                )}
              </div>

              {noteFor?.id === refund.id && (
                <div
                  className={cn(
                    'mt-4 rounded-lg border p-4',
                    noteFor.action === 'approve' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50',
                  )}
                >
                  <Field
                    label={noteFor.action === 'approve' ? 'Note (optional)' : 'Why is this being declined?'}
                    hint={
                      noteFor.action === 'approve'
                        ? 'Approving sends the refund to the payment gateway immediately.'
                        : 'Recorded on the refund for your records.'
                    }
                  >
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      autoFocus
                      placeholder={
                        noteFor.action === 'approve'
                          ? 'Customer contacted support, refund agreed.'
                          : 'Request falls outside the refund window.'
                      }
                    />
                  </Field>

                  <div className="mt-3 flex gap-2">
                    <Button
                      variant={noteFor.action === 'approve' ? 'success' : 'danger'}
                      size="sm"
                      onClick={() => submit(refund.id, noteFor.action)}
                      loading={busyId === refund.id}
                    >
                      {noteFor.action === 'approve' ? 'Approve & process refund' : 'Reject request'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setNoteFor(null);
                        setNote('');
                      }}
                    >
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
