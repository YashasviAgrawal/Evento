'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { cmsApi, ApiError } from '@/lib/cms-api';
import { useCmsAuth } from '@/components/providers/cms-auth-provider';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, DetailRow, Field, Input } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';

export default function CmsAccountPage() {
  const { user, signOut } = useCmsAuth();
  const toast = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await cmsApi.post('/auth/change-password', { currentPassword, newPassword });
      // Changing the password revokes every session, including this one, so
      // there is nothing to stay signed in with.
      toast.success('Password changed', 'Sign in again with your new password.');
      await signOut();
    } catch (err) {
      setError(
        err instanceof ApiError ? [err.message, ...err.fieldMessages].join(' · ') : 'Could not change the password',
      );
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Account" description="Your Studio sign-in. Separate from your Tixit account." />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="mb-2 text-sm font-bold text-ink-900">Details</h2>
          <dl className="divide-y divide-ink-100">
            <DetailRow label="Name" value={user?.fullName ?? '—'} />
            <DetailRow label="Email" value={user?.email ?? '—'} />
            <DetailRow label="Role" value={<span className="capitalize">{user?.role ?? '—'}</span>} />
            <DetailRow
              label="Last signed in"
              value={user?.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'This is your first session'}
            />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            Name, email and role are set by a Studio admin. Ask one of them if any of it needs changing.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold text-ink-900">Change password</h2>

          {error && <Alert tone="error">{error}</Alert>}

          <Field label="Current password">
            <Input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          <Field label="New password" hint="At least 10 characters, with a letter and a number.">
            <Input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          <Field label="Confirm new password">
            <Input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          <Alert tone="warning">
            Changing your password signs you out everywhere, including here. You will need to sign in again.
          </Alert>

          <Button type="submit" loading={saving} className="w-full">
            <KeyRound className="h-4 w-4" />
            Change password
          </Button>
        </form>
      </div>
    </>
  );
}
