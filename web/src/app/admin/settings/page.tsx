'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { PlatformSettings } from '@/lib/types';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Skeleton } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';

export default function AdminSettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PlatformSettings>('/admin/settings')
      .then((response) => setSettings(response.data))
      .catch(() => setSettings(null))
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;

    setSaving(true);
    setError(null);
    try {
      const { data } = await api.patch<PlatformSettings>('/admin/settings', {
        commission_percent: Number(settings.commission_percent),
        tax_percent: Number(settings.tax_percent),
        convenience_fee_percent: Number(settings.convenience_fee_percent),
        booking_hold_minutes: Number(settings.booking_hold_minutes),
        refund_window_hours: Number(settings.refund_window_hours),
        support_email: settings.support_email,
        platform_name: settings.platform_name,
        auto_approve_events: settings.auto_approve_events,
      });
      setSettings(data);
      toast.success('Settings saved', 'New bookings use these values immediately.');
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-96 rounded-xl" />;
  if (!settings) return <p className="text-sm text-ink-500">Could not load settings.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Platform settings" description="Pricing rules and operational policy" />

      {error && (
        <Alert tone="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Alert tone="info">
        These values apply to <strong>new</strong> bookings only. Commission and tax are frozen onto each booking at
        the moment it is created, so historical revenue reports never change retroactively.
      </Alert>

      <form onSubmit={save} className="space-y-5">
        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
          <h2 className="mb-1 text-base font-bold text-ink-900">Pricing</h2>
          <p className="mb-5 text-xs text-ink-500">How each booking total is composed</p>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Commission (%)" hint="Platform cut of ticket revenue">
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="no-spinner"
                value={settings.commission_percent}
                onChange={(e) => update('commission_percent', Number(e.target.value))}
              />
            </Field>

            <Field label="GST (%)" hint="Applied to the discounted subtotal">
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="no-spinner"
                value={settings.tax_percent}
                onChange={(e) => update('tax_percent', Number(e.target.value))}
              />
            </Field>

            <Field label="Convenience fee (%)" hint="Charged to the customer">
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="no-spinner"
                value={settings.convenience_fee_percent}
                onChange={(e) => update('convenience_fee_percent', Number(e.target.value))}
              />
            </Field>
          </div>

          <div className="mt-5 rounded-lg bg-ink-50 p-4 text-xs text-ink-600">
            <p className="font-semibold text-ink-800">Worked example — a ₹1,000 ticket</p>
            <p className="mt-1.5">
              Subtotal ₹1,000 → GST {settings.tax_percent}% = ₹{((1000 * Number(settings.tax_percent)) / 100).toFixed(2)} → fee{' '}
              {settings.convenience_fee_percent}% = ₹
              {((1000 * Number(settings.convenience_fee_percent)) / 100).toFixed(2)} →{' '}
              <strong className="text-ink-900">
                customer pays ₹
                {(1000 + (1000 * Number(settings.tax_percent)) / 100 + (1000 * Number(settings.convenience_fee_percent)) / 100).toFixed(2)}
              </strong>
              . Organizer receives ₹{(1000 - (1000 * Number(settings.commission_percent)) / 100).toFixed(2)}, platform
              keeps ₹{((1000 * Number(settings.commission_percent)) / 100).toFixed(2)}.
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
          <h2 className="mb-1 text-base font-bold text-ink-900">Booking policy</h2>
          <p className="mb-5 text-xs text-ink-500">Inventory holds and cancellation windows</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Inventory hold (minutes)"
              hint="How long a pending booking reserves seats before they are released"
            >
              <Input
                type="number"
                min={1}
                max={1440}
                className="no-spinner"
                value={settings.booking_hold_minutes}
                onChange={(e) => update('booking_hold_minutes', Number(e.target.value))}
              />
            </Field>

            <Field
              label="Refund window (hours before event)"
              hint="Customers can self-cancel up to this many hours before the event"
            >
              <Input
                type="number"
                min={0}
                max={8760}
                className="no-spinner"
                value={settings.refund_window_hours}
                onChange={(e) => update('refund_window_hours', Number(e.target.value))}
              />
            </Field>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-4 transition hover:bg-ink-50">
            <input
              type="checkbox"
              checked={settings.auto_approve_events}
              onChange={(e) => update('auto_approve_events', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              <span className="block text-sm font-medium text-ink-900">Auto-approve submitted events</span>
              <span className="mt-0.5 block text-xs text-ink-500">
                Skip manual review — submitted events publish immediately. Only sensible when every organizer is
                trusted.
              </span>
            </span>
          </label>
        </section>

        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
          <h2 className="mb-5 text-base font-bold text-ink-900">Branding</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Platform name">
              <Input value={settings.platform_name} onChange={(e) => update('platform_name', e.target.value)} />
            </Field>

            <Field label="Support email" hint="Shown to customers on tickets and emails">
              <Input
                type="email"
                value={settings.support_email}
                onChange={(e) => update('support_email', e.target.value)}
              />
            </Field>
          </div>
        </section>

        <Button type="submit" size="lg" loading={saving}>
          <Save className="h-4 w-4" />
          Save settings
        </Button>
      </form>
    </div>
  );
}
