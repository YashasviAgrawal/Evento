'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BadgeCheck, Ban, Percent, Search, ShieldCheck } from 'lucide-react';
import { api, ApiError, type PageMeta } from '@/lib/api';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { EmptyState, Input, Select, Skeleton, StatusBadge } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { cn, formatDateTime, formatMoney, formatNumber } from '@/lib/format';

interface AdminOrganizer {
  id: string;
  displayName: string;
  slug: string;
  status: string;
  commissionPercent: number | null;
  totalEvents: number;
  createdAt: string;
  verifiedAt: string | null;
  gstin: string | null;
  pan: string | null;
  revenuePaise: number;
  user: { fullName: string; email: string; phone: string | null };
}

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'suspended', label: 'Suspended' },
  { key: '', label: 'All' },
];

export default function AdminOrganizersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <OrganizersTable />
    </Suspense>
  );
}

function OrganizersTable() {
  const searchParams = useSearchParams();
  const toast = useToast();

  const [status, setStatus] = useState(searchParams.get('status') ?? 'pending');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [organizers, setOrganizers] = useState<AdminOrganizer[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [commissionFor, setCommissionFor] = useState<string | null>(null);
  const [commissionValue, setCommissionValue] = useState('');

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
      const response = await api.get<AdminOrganizer[]>('/admin/organizers', {
        query: { status: status || undefined, q: debounced || undefined, page, limit: 20 },
      });
      setOrganizers(response.data);
      setMeta(response.meta ?? null);
    } catch {
      setOrganizers([]);
    } finally {
      setLoading(false);
    }
  }, [status, debounced, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function verify(id: string) {
    setBusyId(id);
    try {
      await api.post(`/admin/organizers/${id}/verify`);
      toast.success('Organizer verified', 'They can now publish events.');
      await load();
    } catch (err) {
      toast.error('Could not verify', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function setStatusFor(id: string, next: 'suspended' | 'verified' | 'rejected') {
    setBusyId(id);
    try {
      await api.post(`/admin/organizers/${id}/status`, { status: next });
      toast.success(`Organizer ${next}`);
      await load();
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function saveCommission(id: string) {
    setBusyId(id);
    try {
      await api.post(`/admin/organizers/${id}/commission`, {
        commissionPercent: commissionValue === '' ? null : Number(commissionValue),
      });
      toast.success('Commission updated');
      setCommissionFor(null);
      await load();
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Organizers" description="Verify accounts and set commission rates" />

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
            placeholder="Search organizers"
            className="pl-9"
            aria-label="Search organizers"
          />
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : organizers.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-9 w-9" />}
          title={status === 'pending' ? 'No organizers awaiting verification' : 'No organizers found'}
        />
      ) : (
        <div className="space-y-3">
          {organizers.map((organizer) => (
            <div key={organizer.id} className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-50 text-base font-bold text-violet-700">
                  {organizer.displayName.charAt(0)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-ink-900">{organizer.displayName}</h2>
                    <StatusBadge status={organizer.status} />
                  </div>

                  <p className="mt-1 text-sm text-ink-600">
                    {organizer.user.fullName} · {organizer.user.email}
                    {organizer.user.phone && ` · ${organizer.user.phone}`}
                  </p>

                  <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-500">
                    <span>{formatNumber(organizer.totalEvents)} events</span>
                    <span>
                      <span className="font-semibold text-ink-900">{formatMoney(organizer.revenuePaise, { compact: true })}</span>{' '}
                      revenue
                    </span>
                    <span>
                      Commission:{' '}
                      <span className="font-semibold text-ink-900">
                        {organizer.commissionPercent === null ? 'default' : `${organizer.commissionPercent}%`}
                      </span>
                    </span>
                    {organizer.gstin && <span>GSTIN {organizer.gstin}</span>}
                    {organizer.pan && <span>PAN {organizer.pan}</span>}
                    <span>Joined {formatDateTime(organizer.createdAt)}</span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-start gap-2">
                  {organizer.status !== 'verified' && (
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => verify(organizer.id)}
                      loading={busyId === organizer.id}
                    >
                      <BadgeCheck className="h-3.5 w-3.5" />
                      Verify
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCommissionFor(commissionFor === organizer.id ? null : organizer.id);
                      setCommissionValue(organizer.commissionPercent === null ? '' : String(organizer.commissionPercent));
                    }}
                  >
                    <Percent className="h-3.5 w-3.5" />
                    Commission
                  </Button>

                  {organizer.status !== 'suspended' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-rose-300 text-rose-700 hover:bg-rose-50"
                      onClick={() => setStatusFor(organizer.id, 'suspended')}
                      loading={busyId === organizer.id}
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Suspend
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setStatusFor(organizer.id, 'verified')}>
                      Reinstate
                    </Button>
                  )}
                </div>
              </div>

              {commissionFor === organizer.id && (
                <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4">
                  <div>
                    <label className="label" htmlFor={`commission-${organizer.id}`}>
                      Commission %
                    </label>
                    <Input
                      id={`commission-${organizer.id}`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={commissionValue}
                      onChange={(e) => setCommissionValue(e.target.value)}
                      placeholder="Platform default"
                      className="w-40 no-spinner"
                    />
                  </div>
                  <Button size="sm" onClick={() => saveCommission(organizer.id)} loading={busyId === organizer.id}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCommissionValue('');
                      void saveCommission(organizer.id);
                    }}
                  >
                    Reset to default
                  </Button>
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
