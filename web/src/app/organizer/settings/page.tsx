'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Clock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { City } from '@/lib/types';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, DetailRow, Field, Input, Skeleton, Textarea } from '@/components/ui/index';
import { CityPicker } from '@/components/ui/city-picker';
import { useToast } from '@/components/ui/toast';

interface OrganizerProfile {
  id: string;
  displayName: string;
  slug: string;
  bio: string | null;
  logoUrl: string | null;
  website: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  status: string;
  commissionPercent: number | null;
  totalEvents: number;
  city: { id: string; name: string } | null;
}

export default function OrganizerSettingsPage() {
  const toast = useToast();
  const [profile, setProfile] = useState<OrganizerProfile | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    displayName: '',
    bio: '',
    website: '',
    supportEmail: '',
    supportPhone: '',
    cityId: '',
  });

  useEffect(() => {
    async function load() {
      try {
        const [profileResponse, cityResponse] = await Promise.all([
          api.get<OrganizerProfile>('/organizer/profile'),
          api.get<City[]>('/catalog/cities?counts=false'),
        ]);
        const data = profileResponse.data;
        setProfile(data);
        setCities(cityResponse.data);
        setForm({
          displayName: data.displayName,
          bio: data.bio ?? '',
          website: data.website ?? '',
          supportEmail: data.supportEmail ?? '',
          supportPhone: data.supportPhone ?? '',
          cityId: data.city?.id ?? '',
        });
      } catch {
        setProfile(null);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch('/organizer/profile', {
        displayName: form.displayName.trim(),
        bio: form.bio.trim() || null,
        website: form.website.trim() || null,
        supportEmail: form.supportEmail.trim() || null,
        supportPhone: form.supportPhone.trim() || null,
        cityId: form.cityId || null,
      });
      toast.success('Profile saved');
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : undefined);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-96 rounded-xl" />;
  if (!profile) return <p className="text-sm text-ink-500">Could not load your organizer profile.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Organizer settings" description="How you appear to customers on event pages" />

      {profile.status === 'verified' ? (
        <Alert tone="success" title="Verified organizer">
          <span className="inline-flex items-center gap-1.5">
            <BadgeCheck className="h-4 w-4" />
            Your account is verified — you can publish events.
          </span>
        </Alert>
      ) : profile.status === 'pending' ? (
        <Alert tone="warning" title="Verification pending">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            Your account is verified from your{' '}
            <Link href="/organizer/kyc" className="font-semibold underline">
              KYC submission
            </Link>
            — complete it there if you haven&rsquo;t yet.
          </span>
        </Alert>
      ) : profile.status === 'rejected' ? (
        <Alert tone="error" title="Verification declined">
          Check the reason on your{' '}
          <Link href="/organizer/kyc" className="font-semibold underline">
            KYC submission
          </Link>{' '}
          and submit it again.
        </Alert>
      ) : (
        <Alert tone="error" title={`Account ${profile.status}`}>
          Contact support if you believe this is a mistake.
        </Alert>
      )}

      <form onSubmit={save} className="space-y-5">
        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
          <h2 className="mb-5 text-base font-bold text-ink-900">Public profile</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Organization name" required className="sm:col-span-2">
              <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </Field>

            <Field label="About" hint="Shown on your event pages" className="sm:col-span-2">
              <Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={3} />
            </Field>

            <Field label="Support email">
              <Input
                type="email"
                value={form.supportEmail}
                onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
              />
            </Field>

            <Field label="Support phone">
              <Input value={form.supportPhone} onChange={(e) => setForm({ ...form, supportPhone: e.target.value })} />
            </Field>

            <Field label="Website" className="sm:col-span-2">
              <Input
                type="url"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="https://example.com"
              />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
          <h2 className="mb-1 text-base font-bold text-ink-900">Business details</h2>
          <p className="mb-5 text-xs text-ink-500">
            PAN, GST and your registered address come from your{' '}
            <Link href="/organizer/kyc" className="font-medium underline">
              KYC submission
            </Link>{' '}
            — they are the details we verified your account on, so they change only by resubmitting it.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <dl className="divide-y divide-ink-100 sm:col-span-2">
              <DetailRow label="PAN" value={profile.pan ? <span className="font-mono">{profile.pan}</span> : '—'} />
              <DetailRow
                label="GSTIN"
                value={profile.gstin ? <span className="font-mono">{profile.gstin}</span> : 'Not registered'}
              />
              <DetailRow
                label="Registered address"
                value={profile.address ? <span className="whitespace-pre-line">{profile.address}</span> : '—'}
              />
            </dl>

            <Field label="City" hint="Where customers should find you" className="sm:col-span-2">
              <CityPicker
                cities={cities}
                value={form.cityId}
                onChange={(cityId) => setForm({ ...form, cityId })}
                emptyLabel="Select a city…"
                placeholder="Search any city in India…"
                ariaLabel="Organizer city"
              />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
          <h2 className="mb-1 text-base font-bold text-ink-900">Commission</h2>
          <p className="text-xs text-ink-500">
            The platform fee deducted from your ticket revenue. Set by the Tixit team.
          </p>
          <p className="mt-3 text-2xl font-extrabold text-ink-900">
            {profile.commissionPercent === null ? 'Platform default' : `${profile.commissionPercent}%`}
          </p>
        </section>

        <Button type="submit" size="lg" loading={saving}>
          Save changes
        </Button>
      </form>
    </div>
  );
}
