'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileEdit, ShieldCheck, Trash2 } from 'lucide-react';
import { ApiError, api, authorizedFetch } from '@tixit/session';
import { useToast } from '@tixit/ui';
import { cn, dateTime, relativeDay } from '@/lib/format';
import { RequireAuth } from '@/components/auth/require-auth';
import { Toggle } from '@/components/ui/controls';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/feedback';

interface Consent {
  purpose: string;
  label: string;
  description: string;
  granted: boolean;
  updatedAt: string | null;
}
interface PrivacyRequest {
  reference: string;
  kind: string;
  status: string;
  resolution: string | null;
  due_at: string;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  access: 'Copy of my data',
  correction: 'Correct my data',
  erasure: 'Delete my account',
  nominate: 'Nominate someone',
};

/**
 * The privacy centre: what you've agreed to, a copy of your data, and the
 * rights the DPDP Act gives you — each a tap away, none hidden in email.
 */
function PrivacyCentre() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<'erasure' | 'correction' | null>(null);
  const [details, setDetails] = useState('');
  const [downloading, setDownloading] = useState(false);

  const consents = useQuery({
    queryKey: ['consents'],
    queryFn: async () => (await api.get<{ noticeVersion: string; consents: Consent[] }>('/privacy/consents')).data,
  });
  const requests = useQuery({ queryKey: ['privacy-requests'], queryFn: async () => (await api.get<PrivacyRequest[]>('/privacy/requests')).data });

  const update = useMutation({
    mutationFn: async (change: { purpose: string; granted: boolean }) => (await api.put<Consent[]>('/privacy/consents', { consents: [change] })).data,
    onSuccess: (data) => {
      queryClient.setQueryData(['consents'], (old: { noticeVersion: string } | undefined) => ({ noticeVersion: old?.noticeVersion ?? '', consents: data }));
      toast.success('Preference saved');
    },
  });

  const submit = useMutation({
    mutationFn: async () => (await api.post<{ reference: string }>('/privacy/requests', { kind: sheet, details: details || null })).data,
    onSuccess: (data) => {
      setSheet(null);
      setDetails('');
      toast.success('Request received', `Reference ${data.reference} — we’ve emailed you a copy.`);
      void requests.refetch();
    },
    onError: (err) => toast.error('Could not send the request', err instanceof ApiError ? err.message : undefined),
  });

  async function download() {
    setDownloading(true);
    try {
      const response = await authorizedFetch('/privacy/export');
      const payload = await response.json();
      const blob = new Blob([JSON.stringify(payload.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: 'tixit-my-data.json' });
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not prepare your data', 'Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <section className="mt-6">
        <h2 className="eyebrow text-ink-400">What you’ve agreed to</h2>
        {consents.isLoading ? (
          <Skeleton className="mt-2 h-48 rounded-3xl" />
        ) : (
          <div className="mt-2 space-y-2">
            {consents.data!.consents.map((consent) => (
              <Toggle
                key={consent.purpose}
                checked={consent.granted}
                onChange={(granted) => update.mutate({ purpose: consent.purpose, granted })}
                label={consent.label}
                description={`${consent.description}${consent.updatedAt ? ` · changed ${relativeDay(consent.updatedAt).toLowerCase()}` : ''}`}
              />
            ))}
            <p className="px-1 text-xs text-ink-500">
              Bookings, payments, receipts and safety messages are part of the service and don’t need your consent. You can change these
              any time; withdrawing is as easy as agreeing.
            </p>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="eyebrow text-ink-400">Your rights</h2>
        <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
          <li>
            <button onClick={download} disabled={downloading} className="flex w-full items-center gap-3.5 p-4 text-left transition hover:bg-ink-50 disabled:opacity-60">
              <Download className="h-5 w-5 text-ink-400" />
              <span className="flex-1">
                <span className="block font-semibold">{downloading ? 'Preparing…' : 'Download my data'}</span>
                <span className="block text-xs text-ink-500">Everything we hold about you, as a JSON file</span>
              </span>
            </button>
          </li>
          <li>
            <button onClick={() => setSheet('correction')} className="flex w-full items-center gap-3.5 p-4 text-left transition hover:bg-ink-50">
              <FileEdit className="h-5 w-5 text-ink-400" />
              <span className="flex-1">
                <span className="block font-semibold">Ask us to correct something</span>
                <span className="block text-xs text-ink-500">For details you can’t change yourself</span>
              </span>
            </button>
          </li>
          <li>
            <button onClick={() => setSheet('erasure')} className="flex w-full items-center gap-3.5 p-4 text-left text-rose-700 transition hover:bg-rose-50">
              <Trash2 className="h-5 w-5" />
              <span className="flex-1">
                <span className="block font-semibold">Delete my account</span>
                <span className="block text-xs text-rose-600/80">Removes your identity across Tixit Events and Dine-in</span>
              </span>
            </button>
          </li>
        </ul>
      </section>

      {(requests.data ?? []).length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow text-ink-400">Your requests</h2>
          <ul className="mt-2 space-y-2">
            {requests.data!.map((r) => (
              <li key={r.reference} className="rounded-2xl bg-white p-4 ring-1 ring-ink-200">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{KIND_LABEL[r.kind] ?? r.kind}</span>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] font-bold capitalize',
                      r.status === 'completed' ? 'bg-save-50 text-save-700' : r.status === 'rejected' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700',
                    )}
                  >
                    {r.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  {r.reference} · sent {dateTime(r.created_at)} · reply by {relativeDay(r.due_at)}
                </p>
                {r.resolution && <p className="mt-2 text-sm text-ink-700">{r.resolution}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-sm text-ink-500">
        Something wrong? Write to our{' '}
        <Link href="/grievance" className="font-semibold text-brand-600 underline">
          grievance officer
        </Link>
        .
      </p>

      <Sheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheet === 'erasure' ? 'Delete your Tixit account?' : 'What should we correct?'}
        footer={
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || (sheet === 'correction' && details.trim().length < 5)}
            className={cn('press mb-1 h-12 w-full rounded-2xl font-bold text-white disabled:opacity-50', sheet === 'erasure' ? 'bg-rose-600' : 'bg-ink-900')}
          >
            {submit.isPending ? 'Sending…' : sheet === 'erasure' ? 'Request deletion' : 'Send request'}
          </button>
        }
      >
        {sheet === 'erasure' && (
          <div className="space-y-2 text-sm leading-relaxed text-ink-600">
            <p>We’ll remove your name, contact details, sign-in methods and reviews’ text, and sign you out everywhere — Events and Dine-in.</p>
            <p>Payment and tax records (amounts, dates, codes) stay, because the law requires us to keep them. Unspent wallet cashback is lost.</p>
          </div>
        )}
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value.slice(0, 2000))}
          rows={4}
          className="input mt-3 resize-none text-sm"
          placeholder={sheet === 'erasure' ? 'Anything you’d like us to know (optional)' : 'e.g. My name is spelt Diya, not Dia'}
        />
      </Sheet>
    </>
  );
}

export default function PrivacyPage() {
  return (
    <div className="container-page max-w-2xl py-6 sm:py-10">
      <Link href="/account" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Account
      </Link>
      <h1 className="mt-3 flex items-center gap-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
        <ShieldCheck className="h-7 w-7 text-save-600" /> Privacy
      </h1>
      <p className="mt-1 text-sm text-ink-500">Your choices and your data, for your whole Tixit account.</p>
      <Suspense>
        <RequireAuth>
          <PrivacyCentre />
        </RequireAuth>
      </Suspense>
    </div>
  );
}
