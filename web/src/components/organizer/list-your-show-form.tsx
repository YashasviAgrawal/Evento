'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import type { Category, City } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Select, Textarea } from '@/components/ui/index';
import { CityPicker } from '@/components/ui/city-picker';

const ENQUIRY_EMAIL = 'support@tixit.in';

const AUDIENCE_SIZES = ['Under 100', '100 – 500', '500 – 2,000', '2,000 – 10,000', '10,000+'];

/** Fallback list for when the catalog API is unreachable at build/request time. */
const FALLBACK_EVENT_TYPES = [
  'Music & concerts',
  'Comedy',
  'Workshops',
  'Sports',
  'Theatre',
  'Conferences',
  'Parties & nightlife',
  'Food & drink',
  'Art & exhibitions',
  'Kids & family',
];

interface FormState {
  name: string;
  organization: string;
  email: string;
  phone: string;
  city: string;
  eventType: string;
  audience: string;
  message: string;
}

const EMPTY: FormState = {
  name: '',
  organization: '',
  email: '',
  phone: '',
  city: '',
  eventType: '',
  audience: '',
  message: '',
};

export function ListYourShowForm({ categories, cities }: { categories: Category[]; cities: City[] }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [sent, setSent] = useState(false);

  const eventTypes = categories.length > 0 ? categories.map((category) => category.name) : FALLBACK_EVENT_TYPES;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSent(false);
  }

  /**
   * There is no enquiry endpoint on the API yet, so the form hands the filled
   * details to the organizer's own mail client addressed to our inbox. Nothing
   * is lost if they abandon the draft, and no half-captured lead sits in a
   * table nobody reads.
   */
  function submit(event: React.FormEvent) {
    event.preventDefault();

    const lines = [
      `Name: ${form.name}`,
      form.organization && `Organization: ${form.organization}`,
      `Email: ${form.email}`,
      `Phone: ${form.phone}`,
      form.city && `City: ${form.city}`,
      form.eventType && `Event type: ${form.eventType}`,
      form.audience && `Expected audience: ${form.audience}`,
      '',
      form.message || '(No additional details)',
    ].filter(Boolean);

    const subject = `Listing enquiry — ${form.organization || form.name}`;
    window.location.href = `mailto:${ENQUIRY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
      lines.join('\n'),
    )}`;
    setSent(true);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" required>
          <Input
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="Aditi Sharma"
            autoComplete="name"
            required
          />
        </Field>

        <Field label="Organization or brand">
          <Input
            value={form.organization}
            onChange={(event) => update('organization', event.target.value)}
            placeholder="Sunset Sessions Live"
            autoComplete="organization"
          />
        </Field>

        <Field label="Email" required>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </Field>

        <Field label="Phone" required>
          <Input
            type="tel"
            value={form.phone}
            onChange={(event) => update('phone', event.target.value)}
            placeholder="+91 98765 43210"
            autoComplete="tel"
            required
          />
        </Field>

        <Field label="City">
          <CityPicker
            cities={cities}
            value={form.city}
            valueKey="name"
            onChange={(city) => update('city', city)}
            allLabel="Somewhere else"
            emptyLabel="Select a city"
            placeholder="Search any city in India…"
            ariaLabel="Event city"
          />
        </Field>

        <Field label="What are you listing?">
          <Select value={form.eventType} onChange={(event) => update('eventType', event.target.value)}>
            <option value="">Select an event type</option>
            {eventTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Expected audience">
        <Select value={form.audience} onChange={(event) => update('audience', event.target.value)}>
          <option value="">Select a range</option>
          {AUDIENCE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Tell us about your show"
        hint="Dates, venue, ticket tiers you have in mind — whatever helps us get back to you with something useful."
      >
        <Textarea
          value={form.message}
          onChange={(event) => update('message', event.target.value)}
          placeholder="Two-night indie showcase in March, roughly 600 capacity, three ticket tiers…"
          maxLength={1000}
          rows={4}
        />
      </Field>

      {sent && (
        <Alert tone="success" title="Your email client should be open">
          Send the draft and we&apos;ll reply within one business day. If nothing opened, write to us directly at{' '}
          <a href={`mailto:${ENQUIRY_EMAIL}`} className="font-semibold underline">
            {ENQUIRY_EMAIL}
          </a>
          .
        </Alert>
      )}

      <Button type="submit" size="lg" className="w-full sm:w-auto">
        <Send className="h-4 w-4" aria-hidden />
        Send enquiry
      </Button>

      <p className="text-xs leading-relaxed text-ink-500">
        By sending this you agree to be contacted about listing on Tixit. We never share your details with anyone else.
      </p>
    </form>
  );
}
