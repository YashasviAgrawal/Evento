'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { cmsApi, ApiError } from '@/lib/cms-api';
import type { CmsRole, CmsUser } from '@/lib/types';
import { useCmsAuth } from '@/components/providers/cms-auth-provider';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, Badge, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';

interface NewUserForm {
  fullName: string;
  email: string;
  password: string;
  role: CmsRole;
}

const EMPTY_FORM: NewUserForm = { fullName: '', email: '', password: '', role: 'editor' };

export default function CmsUsersPage() {
  const toast = useToast();
  const { user: me } = useCmsAuth();

  const [users, setUsers] = useState<CmsUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<NewUserForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isAdmin = me?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await cmsApi.get<CmsUser[]>('/users');
      setUsers(data);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The server enforces this too; skipping the fetch just avoids filling the
    // console with 403s for an editor who typed the URL.
    if (isAdmin) void load();
    else setLoading(false);
  }, [isAdmin, load]);

  if (me && !isAdmin) {
    return (
      <>
        <PageHeader title="Accounts" description="Who can sign in to the Studio." />
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="Admin access required"
          description="Managing Studio accounts is limited to admins. Ask one of them to make the change for you."
        />
      </>
    );
  }

  async function create() {
    setSaving(true);
    setError(null);
    try {
      await cmsApi.post('/users', {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
      });
      toast.success('Account created', `Send ${form.email.trim()} their password over a private channel.`);
      setForm(EMPTY_FORM);
      setCreating(false);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? [err.message, ...err.fieldMessages].join(' · ') : 'Could not create the account',
      );
    } finally {
      setSaving(false);
    }
  }

  async function patch(user: CmsUser, body: Record<string, unknown>, successMessage: string) {
    setBusyId(user.id);
    try {
      await cmsApi.patch(`/users/${user.id}`, body);
      toast.success(successMessage);
      await load();
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(user: CmsUser) {
    const password = window.prompt(
      `Set a new password for ${user.email}.\n\nAt least 10 characters, with a letter and a number. They can change it after signing in.`,
    );
    if (!password) return;
    await patch(user, { password }, 'Password reset — their other sessions were signed out');
  }

  async function remove(user: CmsUser) {
    if (!window.confirm(`Remove ${user.email} from the CMS? They lose access immediately.`)) return;
    setBusyId(user.id);
    try {
      await cmsApi.delete(`/users/${user.id}`);
      toast.success('Account removed');
      await load();
    } catch (err) {
      toast.error('Could not remove', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Who can sign in to the Studio. These are separate from Tixit customer, organizer and admin accounts."
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New account
            </Button>
          )
        }
      />

      {creating && (
        <div className="mb-6 space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold text-ink-900">New Studio account</h2>

          {error && <Alert tone="error">{error}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input
                value={form.fullName}
                onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                placeholder="Priya Sharma"
                autoFocus
              />
            </Field>
            <Field label="Email" required>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="priya@example.com"
              />
            </Field>
            <Field label="Temporary password" required hint="At least 10 characters, with a letter and a number.">
              <Input
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="••••••••••"
              />
            </Field>
            <Field label="Role" hint="Admins can also manage these accounts.">
              <Select
                value={form.role}
                onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as CmsRole }))}
              >
                <option value="editor">Editor — writes and publishes</option>
                <option value="admin">Admin — also manages accounts</option>
              </Select>
            </Field>
          </div>

          <Alert tone="info">
            There is no invitation email. Give the person this password over a private channel and ask them to change
            it from Account once they are in.
          </Alert>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={() => void create()} loading={saving}>
              <UserPlus className="h-4 w-4" />
              Create account
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="No Studio accounts"
          description="Create one to give someone access to the blog without giving them a platform admin account."
        />
      ) : (
        <div className="space-y-3">
          {users.map((user) => {
            const isMe = user.id === me?.id;
            const busy = busyId === user.id;

            return (
              <div
                key={user.id}
                className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-ink-200 bg-white p-4 shadow-card"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink-900">{user.fullName}</p>
                    <Badge tone={user.role === 'admin' ? 'brand' : 'neutral'}>{user.role}</Badge>
                    {user.status === 'suspended' && <Badge tone="danger">Suspended</Badge>}
                    {isMe && <Badge tone="info">You</Badge>}
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-500">{user.email}</p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {user.lastLoginAt
                      ? `Last signed in ${formatDateTime(user.lastLoginAt)}`
                      : 'Has never signed in'}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Select
                    value={user.role}
                    disabled={busy}
                    onChange={(event) =>
                      void patch(user, { role: event.target.value }, `${user.fullName} is now an ${event.target.value}`)
                    }
                    className="h-8 w-auto py-0 text-xs"
                    aria-label={`Role for ${user.fullName}`}
                  >
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </Select>

                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void resetPassword(user)}>
                    <KeyRound className="h-3.5 w-3.5" />
                    Reset
                  </Button>

                  {/* Suspending keeps the account and its history; deleting does
                      not. Suspension is the reversible one, so it comes first. */}
                  {!isMe && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void patch(
                          user,
                          { status: user.status === 'active' ? 'suspended' : 'active' },
                          user.status === 'active' ? 'Account suspended' : 'Account restored',
                        )
                      }
                    >
                      {user.status === 'active' ? 'Suspend' : 'Restore'}
                    </Button>
                  )}

                  {!isMe && (
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void remove(user)}
                      aria-label={`Remove ${user.fullName}`}
                      className="text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
