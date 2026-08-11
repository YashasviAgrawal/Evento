'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, Plus, Trash2, Upload } from 'lucide-react';
import { api, ApiError, API_URL, tokenStore } from '@/lib/api';
import type { Category, City } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Select, Textarea } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/format';

const TICKET_KINDS = [
  { value: 'regular', label: 'Regular' },
  { value: 'vip', label: 'VIP' },
  { value: 'early_bird', label: 'Early Bird' },
  { value: 'couple_pass', label: 'Couple Pass' },
  { value: 'group_pass', label: 'Group Pass' },
];

interface TierDraft {
  key: string;
  name: string;
  kind: string;
  description: string;
  price: string;
  quantityTotal: string;
  maxPerOrder: string;
  seatsPerTicket: string;
}

function emptyTier(index = 0): TierDraft {
  return {
    key: `tier-${Date.now()}-${index}`,
    name: '',
    kind: 'regular',
    description: '',
    price: '',
    quantityTotal: '',
    maxPerOrder: '10',
    seatsPerTicket: '1',
  };
}

/** Convert a datetime-local value to an ISO string the API accepts. */
function toIso(value: string): string {
  return new Date(value).toISOString();
}

export function EventForm({ eventId }: { eventId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = Boolean(eventId);

  const [categories, setCategories] = useState<Category[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    description: '',
    categoryId: '',
    startsAt: '',
    endsAt: '',
    language: 'English',
    ageLimit: '',
    terms: '',
    tags: '',
    bannerUrl: '',
    venueName: '',
    addressLine1: '',
    cityId: '',
    landmark: '',
    postalCode: '',
  });

  const [tiers, setTiers] = useState<TierDraft[]>([emptyTier()]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const [categoryResponse, cityResponse] = await Promise.all([
          api.get<Category[]>('/catalog/categories'),
          api.get<City[]>('/catalog/cities'),
        ]);
        setCategories(categoryResponse.data);
        setCities(cityResponse.data);

        if (eventId) {
          const { data } = await api.get<Record<string, never>>(`/organizer/events/${eventId}`);
          const event = data as unknown as {
            title: string;
            subtitle: string | null;
            description: string;
            category: { id: string };
            startsAt: string;
            endsAt: string;
            language: string;
            ageLimit: number | null;
            terms: string | null;
            tags: string[];
            bannerUrl: string | null;
            venue: { name: string; addressLine1: string; landmark: string | null; postalCode: string | null };
            city: { id: string };
          };

          setForm({
            title: event.title,
            subtitle: event.subtitle ?? '',
            description: event.description,
            categoryId: event.category.id,
            // datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
            startsAt: toLocalInput(event.startsAt),
            endsAt: toLocalInput(event.endsAt),
            language: event.language,
            ageLimit: event.ageLimit ? String(event.ageLimit) : '',
            terms: event.terms ?? '',
            tags: (event.tags ?? []).join(', '),
            bannerUrl: event.bannerUrl ?? '',
            venueName: event.venue.name,
            addressLine1: event.venue.addressLine1,
            cityId: event.city.id,
            landmark: event.venue.landmark ?? '',
            postalCode: event.venue.postalCode ?? '',
          });
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load the form');
      } finally {
        setLoading(false);
      }
    }
    void bootstrap();
  }, [eventId]);

  function toLocalInput(iso: string): string {
    const date = new Date(iso);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (form.title.trim().length < 3) next.title = 'Give your event a title';
    if (!form.categoryId) next.categoryId = 'Choose a category';
    if (!form.startsAt) next.startsAt = 'Set a start date and time';
    if (!form.endsAt) next.endsAt = 'Set an end date and time';
    if (form.startsAt && form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt)) {
      next.endsAt = 'The event must end after it starts';
    }
    if (!form.cityId) next.cityId = 'Choose a city';
    if (form.venueName.trim().length < 2) next.venueName = 'Enter the venue name';
    if (form.addressLine1.trim().length < 3) next.addressLine1 = 'Enter the venue address';

    if (!isEdit) {
      const valid = tiers.filter((tier) => tier.name.trim() && tier.quantityTotal);
      if (valid.length === 0) next.tiers = 'Add at least one ticket type';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function uploadBanner(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('folder', 'events');

      // FormData must not carry a JSON content-type, so this bypasses `api`.
      const response = await fetch(`${API_URL}/uploads/image`, {
        method: 'POST',
        headers: tokenStore.access ? { authorization: `Bearer ${tokenStore.access}` } : {},
        body,
        credentials: 'include',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Upload failed');

      setForm((current) => ({ ...current, bannerUrl: payload.data.url }));
      toast.success('Image uploaded');
    } catch (err) {
      toast.error('Upload failed', err instanceof Error ? err.message : undefined);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    setSaving(true);
    setError(null);

    const payload = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || undefined,
      description: form.description.trim(),
      categoryId: form.categoryId,
      startsAt: toIso(form.startsAt),
      endsAt: toIso(form.endsAt),
      language: form.language,
      ageLimit: form.ageLimit ? Number(form.ageLimit) : undefined,
      terms: form.terms.trim() || undefined,
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      bannerUrl: form.bannerUrl || undefined,
      venue: {
        name: form.venueName.trim(),
        addressLine1: form.addressLine1.trim(),
        cityId: form.cityId,
        landmark: form.landmark.trim() || undefined,
        postalCode: form.postalCode.trim() || undefined,
      },
      ...(isEdit
        ? {}
        : {
            ticketTypes: tiers
              .filter((tier) => tier.name.trim() && tier.quantityTotal)
              .map((tier, index) => ({
                name: tier.name.trim(),
                kind: tier.kind,
                description: tier.description.trim() || undefined,
                price: Number(tier.price || 0),
                quantityTotal: Number(tier.quantityTotal),
                maxPerOrder: Number(tier.maxPerOrder || 10),
                seatsPerTicket: Number(tier.seatsPerTicket || 1),
                displayOrder: index,
              })),
          }),
    };

    try {
      if (isEdit) {
        await api.patch(`/organizer/events/${eventId}`, payload);
        toast.success('Event updated');
        router.push(`/organizer/events/${eventId}`);
      } else {
        const { data } = await api.post<{ id: string }>('/organizer/events', payload);
        toast.success('Event created', 'Add finishing touches, then submit it for review.');
        router.push(`/organizer/events/${data.id}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Could not save the event');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="h-96 animate-pulse rounded-xl bg-white" />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <Alert tone="error" title="Could not save" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* ── Basics ── */}
      <Section title="Event basics" description="What is happening, and how should we describe it?">
        <Field label="Event title" required error={errors.title} className="sm:col-span-2">
          <Input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Sunburn Arena ft. Alan Walker"
            invalid={Boolean(errors.title)}
          />
        </Field>

        <Field label="Tagline" hint="A one-line hook shown under the title" className="sm:col-span-2">
          <Input
            value={form.subtitle}
            onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
            placeholder="India tour 2026 — the biggest EDM night of the year"
          />
        </Field>

        <Field label="Category" required error={errors.categoryId}>
          <Select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            invalid={Boolean(errors.categoryId)}
          >
            <option value="">Choose a category…</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Language">
          <Input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
        </Field>

        <Field label="Description" hint="Markdown-free plain text; blank lines create paragraphs" className="sm:col-span-2">
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={6}
            placeholder="Tell attendees what to expect…"
          />
        </Field>

        <Field label="Tags" hint="Comma separated — helps people find your event" className="sm:col-span-2">
          <Input
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="edm, concert, nightlife"
          />
        </Field>
      </Section>

      {/* ── Banner ── */}
      <Section title="Cover image" description="Shown on listing cards and at the top of the event page">
        <div className="sm:col-span-2">
          {form.bannerUrl ? (
            <div className="relative overflow-hidden rounded-xl border border-ink-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.bannerUrl} alt="Event banner preview" className="h-48 w-full object-cover" />
              <button
                type="button"
                onClick={() => setForm({ ...form, bannerUrl: '' })}
                className="absolute right-3 top-3 rounded-lg bg-ink-950/70 p-2 text-white transition hover:bg-ink-950"
                aria-label="Remove image"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label
              className={cn(
                'flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300 bg-ink-50 transition hover:border-brand-400 hover:bg-brand-50/40',
                uploading && 'pointer-events-none opacity-60',
              )}
            >
              {uploading ? (
                <>
                  <Upload className="h-6 w-6 animate-pulse text-ink-400" />
                  <span className="text-sm text-ink-500">Uploading…</span>
                </>
              ) : (
                <>
                  <ImagePlus className="h-6 w-6 text-ink-400" />
                  <span className="text-sm font-medium text-ink-700">Click to upload a cover image</span>
                  <span className="text-xs text-ink-500">JPEG, PNG or WebP · up to 8 MB</span>
                </>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadBanner(file);
                }}
              />
            </label>
          )}

          <Field label="…or paste an image URL" className="mt-3">
            <Input
              value={form.bannerUrl}
              onChange={(e) => setForm({ ...form, bannerUrl: e.target.value })}
              placeholder="https://images.unsplash.com/…"
            />
          </Field>
        </div>
      </Section>

      {/* ── Schedule ── */}
      <Section title="Date & time" description="When does it start and finish?">
        <Field label="Starts at" required error={errors.startsAt}>
          <Input
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            invalid={Boolean(errors.startsAt)}
          />
        </Field>

        <Field label="Ends at" required error={errors.endsAt}>
          <Input
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            invalid={Boolean(errors.endsAt)}
          />
        </Field>

        <Field label="Minimum age" hint="Leave blank for all ages">
          <Input
            type="number"
            min={0}
            max={100}
            value={form.ageLimit}
            onChange={(e) => setForm({ ...form, ageLimit: e.target.value })}
            placeholder="18"
          />
        </Field>
      </Section>

      {/* ── Venue ── */}
      <Section title="Venue" description="Where should attendees go?">
        <Field label="Venue name" required error={errors.venueName}>
          <Input
            value={form.venueName}
            onChange={(e) => setForm({ ...form, venueName: e.target.value })}
            placeholder="Jio World Garden"
            invalid={Boolean(errors.venueName)}
          />
        </Field>

        <Field label="City" required error={errors.cityId}>
          <Select
            value={form.cityId}
            onChange={(e) => setForm({ ...form, cityId: e.target.value })}
            invalid={Boolean(errors.cityId)}
          >
            <option value="">Choose a city…</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}, {city.state}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Address" required error={errors.addressLine1} className="sm:col-span-2">
          <Input
            value={form.addressLine1}
            onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
            placeholder="G Block, Bandra Kurla Complex"
            invalid={Boolean(errors.addressLine1)}
          />
        </Field>

        <Field label="Landmark" hint="Optional">
          <Input
            value={form.landmark}
            onChange={(e) => setForm({ ...form, landmark: e.target.value })}
            placeholder="Opposite Trident Hotel"
          />
        </Field>

        <Field label="PIN code" hint="Optional">
          <Input
            value={form.postalCode}
            onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
            placeholder="400051"
          />
        </Field>
      </Section>

      {/* ── Ticket tiers (create only) ── */}
      {!isEdit && (
        <Section
          title="Ticket types"
          description="Set your tiers, prices and how many of each are available"
          error={errors.tiers}
        >
          <div className="space-y-4 sm:col-span-2">
            {tiers.map((tier, index) => (
              <div key={tier.key} className="rounded-xl border border-ink-200 bg-ink-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink-800">Tier {index + 1}</span>
                  {tiers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setTiers(tiers.filter((entry) => entry.key !== tier.key))}
                      className="text-rose-600 transition hover:text-rose-800"
                      aria-label={`Remove tier ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Name">
                    <Input
                      value={tier.name}
                      onChange={(e) => updateTier(tier.key, { name: e.target.value })}
                      placeholder="Early Bird"
                    />
                  </Field>

                  <Field label="Type">
                    <Select value={tier.kind} onChange={(e) => updateTier(tier.key, { kind: e.target.value })}>
                      {TICKET_KINDS.map((kind) => (
                        <option key={kind.value} value={kind.value}>
                          {kind.label}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Price (₹)" hint="0 for free">
                    <Input
                      type="number"
                      min={0}
                      className="no-spinner"
                      value={tier.price}
                      onChange={(e) => updateTier(tier.key, { price: e.target.value })}
                      placeholder="1499"
                    />
                  </Field>

                  <Field label="Quantity">
                    <Input
                      type="number"
                      min={1}
                      className="no-spinner"
                      value={tier.quantityTotal}
                      onChange={(e) => updateTier(tier.key, { quantityTotal: e.target.value })}
                      placeholder="300"
                    />
                  </Field>

                  <Field label="Max per order" hint="Also caps how many one customer can buy in total">
                    <Input
                      type="number"
                      min={1}
                      className="no-spinner"
                      value={tier.maxPerOrder}
                      onChange={(e) => updateTier(tier.key, { maxPerOrder: e.target.value })}
                    />
                  </Field>

                  <Field label="Admits" hint="2 for a couple pass, 4 for a group">
                    <Input
                      type="number"
                      min={1}
                      className="no-spinner"
                      value={tier.seatsPerTicket}
                      onChange={(e) => updateTier(tier.key, { seatsPerTicket: e.target.value })}
                    />
                  </Field>

                  <Field label="Description" hint="Optional" className="sm:col-span-2">
                    <Input
                      value={tier.description}
                      onChange={(e) => updateTier(tier.key, { description: e.target.value })}
                      placeholder="Includes a welcome drink"
                    />
                  </Field>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              onClick={() => setTiers([...tiers, emptyTier(tiers.length)])}
              disabled={tiers.length >= 8}
            >
              <Plus className="h-4 w-4" />
              Add another tier
            </Button>
          </div>
        </Section>
      )}

      {/* ── Terms ── */}
      <Section title="Terms & conditions" description="Shown on the event page and printed on every ticket">
        <Field className="sm:col-span-2">
          <Textarea
            value={form.terms}
            onChange={(e) => setForm({ ...form, terms: e.target.value })}
            rows={4}
            placeholder="Tickets are non-transferable. Carry a valid photo ID…"
          />
        </Field>
      </Section>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" loading={saving}>
          {isEdit ? 'Save changes' : 'Create event'}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );

  function updateTier(key: string, patch: Partial<TierDraft>) {
    setTiers((current) => current.map((tier) => (tier.key === key ? { ...tier, ...patch } : tier)));
  }
}

function Section({
  title,
  description,
  error,
  children,
}: {
  title: string;
  description?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
      <div className="mb-5">
        <h2 className="text-base font-bold text-ink-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
        {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
