'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { ApiError, api, useAuth } from '@tixit/session';
import { cn } from '@/lib/format';

const CATEGORIES = [
  ['payment', 'A payment or refund'],
  ['booking', 'A booking'],
  ['restaurant', 'A restaurant'],
  ['privacy', 'My data'],
  ['account', 'My account'],
  ['other', 'Something else'],
] as const;

export function GrievanceForm() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', phone: '', category: 'payment', subject: '', body: '', orderRef: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; dueAt: string } | null>(null);

  useEffect(() => {
    if (user) setForm((f) => ({ ...f, name: f.name || user.fullName, email: f.email || user.email, phone: f.phone || (user.phone ?? '') }));
  }, [user]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<{ reference: string; dueAt: string }>('/privacy/grievances', {
        ...form,
        phone: form.phone || null,
        orderRef: form.orderRef || null,
      });
      setDone(data);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Could not send your complaint');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-6 rounded-3xl bg-white p-6 text-center ring-1 ring-ink-200">
        <CheckCircle2 className="mx-auto h-12 w-12 text-save-600" />
        <h2 className="mt-3 text-xl font-extrabold">We’ve got it</h2>
        <p className="mt-1 text-sm text-ink-600">
          Your reference is <b className="num">{done.reference}</b>. We’ve emailed you a copy and will respond by{' '}
          {new Date(done.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.
        </p>
      </div>
    );
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form onSubmit={submit} className="mt-6 space-y-4 rounded-3xl bg-white p-5 ring-1 ring-ink-200 sm:p-6">
      <div>
        <p className="label">What is it about?</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(([value, label]) => (
            <button
              type="button"
              key={value}
              onClick={() => setForm((f) => ({ ...f, category: value }))}
              className={cn('h-9 rounded-full px-3.5 text-[13px] font-semibold', form.category === value ? 'bg-ink-900 text-white' : 'ring-1 ring-inset ring-ink-200')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="g-name">Your name</label>
          <input id="g-name" className="input" value={form.name} onChange={set('name')} required />
        </div>
        <div>
          <label className="label" htmlFor="g-email">Email</label>
          <input id="g-email" type="email" className="input" value={form.email} onChange={set('email')} required />
        </div>
        <div>
          <label className="label" htmlFor="g-phone">Phone (optional)</label>
          <input id="g-phone" className="input" value={form.phone} onChange={set('phone')} />
        </div>
        <div>
          <label className="label" htmlFor="g-ref">Bill or booking code (optional)</label>
          <input id="g-ref" className="input uppercase" value={form.orderRef} onChange={set('orderRef')} placeholder="BIL-… or DIN-…" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="g-subject">Subject</label>
        <input id="g-subject" className="input" value={form.subject} onChange={set('subject')} required minLength={4} />
      </div>
      <div>
        <label className="label" htmlFor="g-body">What happened?</label>
        <textarea id="g-body" rows={5} className="input resize-none" value={form.body} onChange={set('body')} required minLength={10} />
      </div>
      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
      <button disabled={busy} className="press h-12 w-full rounded-2xl bg-ink-900 font-bold text-white disabled:opacity-60 sm:w-auto sm:px-8">
        {busy ? 'Sending…' : 'Send to the grievance officer'}
      </button>
    </form>
  );
}
