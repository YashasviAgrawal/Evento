'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { KeyRound, LogOut, Save, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { City } from '@/lib/types';
import { useAuth } from '@/components/providers/auth-provider';
import { RequireAuth } from '@/components/auth/require-auth';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Select, StatusBadge } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, initials } from '@/lib/format';

export default function ProfilePage() {
  return (
    <RequireAuth>
      <Profile />
    </RequireAuth>
  );
}

function Profile() {
  const { user, refreshUser, signOut } = useAuth();
  const toast = useToast();

  const [cities, setCities] = useState<City[]>([]);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ fullName: '', phone: '', cityId: '' });
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });

  useEffect(() => {
    api
      .get<City[]>('/catalog/cities')
      .then((response) => setCities(response.data))
      .catch(() => setCities([]));
  }, []);

  useEffect(() => {
    if (user) {
      setForm({ fullName: user.fullName, phone: user.phone ?? '', cityId: user.cityId ?? '' });
    }
  }, [user]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch('/auth/me', {
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || null,
        cityId: form.cityId || null,
      });
      await refreshUser();
      toast.success('Profile updated');
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (passwords.next.length < 8) {
      toast.error('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (passwords.next !== passwords.confirm) {
      toast.error('Passwords do not match');
      return;
    }

    setChangingPassword(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwords.current,
        newPassword: passwords.next,
      });
      // The API revokes every session on a password change, so sign out here.
      toast.success('Password updated', 'Please sign in again.');
      setPasswords({ current: '', next: '', confirm: '' });
      setTimeout(() => void signOut(), 1200);
    } catch (err) {
      toast.error('Could not change password', err instanceof ApiError ? err.message : undefined);
    } finally {
      setChangingPassword(false);
    }
  }

  if (!user) return null;

  return (
    <div className="container-page max-w-3xl py-8 lg:py-10">
      <div className="mb-7 flex items-center gap-4">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-600 text-xl font-bold text-white">
          {initials(user.fullName)}
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">{user.fullName}</h1>
          <p className="mt-0.5 text-sm text-ink-500">{user.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="badge bg-ink-100 capitalize text-ink-700 ring-ink-200">{user.role}</span>
            {user.emailVerified ? (
              <span className="badge bg-emerald-50 text-emerald-700 ring-emerald-200">
                <ShieldCheck className="h-3 w-3" aria-hidden />
                Email verified
              </span>
            ) : (
              <Link
                href={`/auth/verify-email?flow=verify_email&email=${encodeURIComponent(user.email)}&next=/account/profile`}
                className="badge bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100"
              >
                Email not verified — verify now
              </Link>
            )}
            {user.organizer && <StatusBadge status={user.organizer.status} />}
          </div>
        </div>
      </div>

      {error && (
        <Alert tone="error" className="mb-5" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <form onSubmit={saveProfile} className="mb-6 rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
        <h2 className="mb-5 text-base font-bold text-ink-900">Personal details</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </Field>

          <Field label="Phone">
            <Input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="9876543210"
            />
          </Field>

          <Field label="Email" hint="Contact support to change your email">
            <Input value={user.email} disabled />
          </Field>

          <Field label="Home city" hint="We’ll show you events here first">
            <Select value={form.cityId} onChange={(e) => setForm({ ...form, cityId: e.target.value })}>
              <option value="">No preference</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}, {city.state}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Button type="submit" className="mt-5" loading={saving}>
          <Save className="h-4 w-4" />
          Save changes
        </Button>
      </form>

      <form onSubmit={changePassword} className="mb-6 rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
          <KeyRound className="h-4 w-4 text-ink-400" aria-hidden />
          Change password
        </h2>
        <p className="mb-5 mt-0.5 text-xs text-ink-500">
          Changing your password signs you out of every device.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Current password" required>
            <Input
              type="password"
              value={passwords.current}
              onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
              autoComplete="current-password"
            />
          </Field>

          <Field label="New password" required hint="At least 8 characters">
            <Input
              type="password"
              value={passwords.next}
              onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
              autoComplete="new-password"
            />
          </Field>

          <Field label="Confirm new password" required>
            <Input
              type="password"
              value={passwords.confirm}
              onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
              autoComplete="new-password"
            />
          </Field>
        </div>

        <Button
          type="submit"
          variant="outline"
          className="mt-5"
          loading={changingPassword}
          disabled={!passwords.current || !passwords.next}
        >
          Update password
        </Button>
      </form>

      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
        <h2 className="text-base font-bold text-ink-900">Account</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-500">Member since</dt>
            <dd className="font-medium text-ink-900">{formatDateTime(user.createdAt)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-500">Account ID</dt>
            <dd className="font-mono text-xs text-ink-600">{user.id}</dd>
          </div>
        </dl>

        <Button variant="ghost" className="mt-5 text-rose-600 hover:bg-rose-50" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
