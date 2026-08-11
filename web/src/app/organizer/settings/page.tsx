'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, Clock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { City } from '@/lib/types';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Select, Skeleton, Textarea } from '@/components/ui/index';
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
    gstin: '',
    pan: '',
    address: '',
    cityId: '',
  });

  useEffect(() => {
    async function load() {
      try {
        const [profileResponse, cityResponse] = await Promise.all([
          api.get<OrganizerProfile>('/organizer/profile'),
          api.get<City[]>('/catalog/cities'),
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
          gstin: data.gstin ?? '',
          pan: data.pan ?? '',
          address: data.address ?? '',
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
        gstin: form.gstin.trim() || null,
        pan: form.pan.trim() || null,
        address: form.address.trim() || null,
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
            Our team is reviewing your account. Adding your GSTIN and PAN speeds this up.
          </span>
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
          <p className="mb-5 text-xs text-ink-500">Used for verification, invoicing and payouts</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="GSTIN">
              <Input
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                placeholder="22AAAAA0000A1Z5"
                className="font-mono"
              />
            </Field>

            <Field label="PAN">
              <Input
                value={form.pan}
                onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                placeholder="AAAAA0000A"
                className="font-mono"
              />
            </Field>

            <Field label="City">
              <Select value={form.cityId} onChange={(e) => setForm({ ...form, cityId: e.target.value })}>
                <option value="">Select a city…</option>
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Registered address" className="sm:col-span-2">
              <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
          <h2 className="mb-1 text-base font-bold text-ink-900">Commission</h2>
          <p className="text-xs text-ink-500">
            The platform fee deducted from your ticket revenue. Set by the Evento team.
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
