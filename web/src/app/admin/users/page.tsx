'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Search, Users } from 'lucide-react';
import { api, ApiError, type PageMeta } from '@/lib/api';
import { useAuth } from '@/components/providers/auth-provider';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { EmptyState, Input, Select, Skeleton, StatusBadge } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, formatNumber, initials } from '@/lib/format';

interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  emailVerified: boolean;
  bookings: number;
}

export default function AdminUsersPage() {
  const toast = useToast();
  const { user: currentUser } = useAuth();

  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      const response = await api.get<AdminUser[]>('/admin/users', {
        query: { role: role || undefined, status: status || undefined, q: debounced || undefined, page, limit: 20 },
      });
      setUsers(response.data);
      setMeta(response.meta ?? null);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [role, status, debounced, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleStatus(user: AdminUser) {
    const next = user.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !window.confirm(`Suspend ${user.fullName}? They will be signed out immediately.`)) {
      return;
    }
    setBusyId(user.id);
    try {
      await api.post(`/admin/users/${user.id}/status`, { status: next });
      toast.success(next === 'suspended' ? 'User suspended' : 'User reinstated');
      await load();
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Users" description="Everyone with an Evento account" />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="pl-9"
            aria-label="Search users"
          />
        </div>

        <Select
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          <option value="customer">Customers</option>
          <option value="organizer">Organizers</option>
          <option value="admin">Admins</option>
        </Select>

        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>

      {loading ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : users.length === 0 ? (
        <EmptyState icon={<Users className="h-9 w-9" />} title="No users found" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-5 py-3 font-semibold">Role</th>
                  <th className="px-5 py-3 text-right font-semibold">Bookings</th>
                  <th className="px-5 py-3 font-semibold">Joined</th>
                  <th className="px-5 py-3 font-semibold">Last seen</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {users.map((user) => (
                  <tr key={user.id} className="transition hover:bg-ink-50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-200 text-xs font-bold text-ink-700">
                          {initials(user.fullName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink-900">{user.fullName}</p>
                          <p className="truncate text-xs text-ink-500">
                            {user.email}
                            {user.emailVerified && (
                              <CheckCircle2 className="ml-1 inline h-3 w-3 text-emerald-600" aria-label="Email verified" />
                            )}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="capitalize text-ink-700">{user.role}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">{formatNumber(user.bookings)}</td>
                    <td className="px-5 py-3.5 text-xs text-ink-500">{formatDateTime(user.createdAt)}</td>
                    <td className="px-5 py-3.5 text-xs text-ink-500">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {user.id === currentUser?.id ? (
                        <span className="text-xs text-ink-400">That&apos;s you</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={user.status === 'active' ? 'text-rose-600 hover:bg-rose-50' : ''}
                          onClick={() => toggleStatus(user)}
                          loading={busyId === user.id}
                        >
                          {user.status === 'active' ? (
                            <>
                              <Ban className="h-3.5 w-3.5" />
                              Suspend
                            </>
                          ) : (
                            'Reinstate'
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-ink-200 px-5 py-3">
              <p className="text-xs text-ink-500">
                {formatNumber(meta.total)} users · page {meta.page} of {meta.totalPages}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
