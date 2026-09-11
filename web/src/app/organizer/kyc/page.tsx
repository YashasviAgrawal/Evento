'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, Building2, Clock, Landmark, Lock, ShieldCheck, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { KycState } from '@/lib/types';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, DetailRow, Field, Input, Skeleton, StatusBadge, Textarea } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';

/**
 * Payout KYC.
 *
 * Everything the finance team needs before it can send an organizer money:
 * who they are (PAN), what the business is (GSTIN, registered address) and
 * where the money goes (account, IFSC, holder name). Validation mirrors the
 * server's — the same formats are enforced again in the API and the database,
 * because an unpayable account number is expensive to discover at transfer
 * time.
 */

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{2}[0-9A-Z]$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_PATTERN = /^[0-9]{9,18}$/;

interface FormState {
  legalName: string;
  pan: string;
  businessName: string;
  gstin: string;
  businessAddress: string;
  accountHolderName: string;
  accountNumber: string;
  confirmAccountNumber: string;
  ifsc: string;
  bankName: string;
}

const EMPTY_FORM: FormState = {
  legalName: '',
  pan: '',
  businessName: '',
  gstin: '',
  businessAddress: '',
  accountHolderName: '',
  accountNumber: '',
  confirmAccountNumber: '',
  ifsc: '',
  bankName: '',
};

export default function OrganizerKycPage() {
  const toast = useToast();

  const [state, setState] = useState<KycState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get<KycState>('/organizer/kyc');
        setState(data);
        if (data.kyc) {
          setForm({
            legalName: data.kyc.legalName,
            pan: data.kyc.pan,
            businessName: data.kyc.businessName,
            gstin: data.kyc.gstin ?? '',
            businessAddress: data.kyc.businessAddress,
            accountHolderName: data.kyc.accountHolderName,
            accountNumber: data.kyc.accountNumber,
            confirmAccountNumber: data.kyc.accountNumber,
            ifsc: data.kyc.ifsc,
            bankName: data.kyc.bankName ?? '',
          });
        }
      } catch {
        setState(null);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};

    if (form.legalName.trim().length < 2) next.legalName = 'Enter your full name as printed on your PAN card';
    if (!PAN_PATTERN.test(form.pan.trim())) next.pan = 'PAN looks like AAAAA0000A';
    if (form.businessName.trim().length < 2) next.businessName = 'Enter your registered business or brand name';
    if (form.gstin.trim() && !GSTIN_PATTERN.test(form.gstin.trim())) {
      next.gstin = 'GSTIN is 15 characters, e.g. 22AAAAA0000A1Z5';
    }
    if (form.businessAddress.trim().length < 10) next.businessAddress = 'Enter the full registered address';
    if (form.accountHolderName.trim().length < 2) next.accountHolderName = 'Enter the name on the bank account';
    if (!ACCOUNT_PATTERN.test(form.accountNumber.trim())) next.accountNumber = 'Account number is 9–18 digits';
    else if (form.accountNumber.trim() !== form.confirmAccountNumber.trim()) {
      next.confirmAccountNumber = 'The two account numbers do not match';
    }
    if (!IFSC_PATTERN.test(form.ifsc.trim())) next.ifsc = 'IFSC looks like HDFC0001234';

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const { data } = await api.post<KycState['kyc']>('/organizer/kyc', {
        legalName: form.legalName.trim(),
        pan: form.pan.trim().toUpperCase(),
        businessName: form.businessName.trim(),
        gstin: form.gstin.trim().toUpperCase() || null,
        businessAddress: form.businessAddress.trim(),
        accountHolderName: form.accountHolderName.trim(),
        accountNumber: form.accountNumber.trim(),
        ifsc: form.ifsc.trim().toUpperCase(),
        bankName: form.bankName.trim() || null,
      });
      setState({ status: 'pending', payoutsEnabled: false, kyc: data });
      toast.success('Details submitted', 'Our team will verify them, usually within a working day.');
    } catch (err) {
      toast.error('Could not submit', err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : undefined);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-96 rounded-xl" />;
  if (!state) return <p className="text-sm text-ink-500">Could not load your payout details.</p>;

  // Approved details are frozen: changing a verified bank account is a review
  // decision, so the screen becomes a read-only summary.
  if (state.status === 'approved' && state.kyc) {
    const kyc = state.kyc;
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader title="Payout details" description="Verified — this is where your ticket revenue is settled" />

        <Alert tone="success" title="Verified">
          <span className="inline-flex items-center gap-1.5">
            <BadgeCheck className="h-4 w-4" />
            Your payout details were verified
            {kyc.reviewedAt ? ` on ${formatDateTime(kyc.reviewedAt)}` : ''}.
          </span>
        </Alert>

        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
          <div className="mb-2 flex items-center gap-2">
            <Lock className="h-4 w-4 text-ink-400" />
            <h2 className="text-base font-bold text-ink-900">Locked details</h2>
          </div>
          <p className="mb-4 text-xs text-ink-500">
            To change any of these, contact support — verified bank details cannot be edited from the dashboard.
          </p>

          <dl className="divide-y divide-ink-100">
            <DetailRow label="Name (as on PAN)" value={kyc.legalName} />
            <DetailRow label="PAN" value={<span className="font-mono">{kyc.pan}</span>} />
            <DetailRow label="Business name" value={kyc.businessName} />
            <DetailRow label="GSTIN" value={kyc.gstin ? <span className="font-mono">{kyc.gstin}</span> : 'Not registered'} />
            <DetailRow label="Business address" value={<span className="whitespace-pre-line">{kyc.businessAddress}</span>} />
            <DetailRow label="Account holder" value={kyc.accountHolderName} />
            <DetailRow label="Account number" value={<span className="font-mono">{kyc.accountNumber}</span>} />
            <DetailRow label="IFSC" value={<span className="font-mono">{kyc.ifsc}</span>} />
            <DetailRow label="Bank" value={kyc.bankName ?? '—'} />
          </dl>
        </section>
      </div>
    );
  }

  const isResubmission = state.status === 'rejected';

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Payout details"
        description="Verify your identity and bank account so we can settle your ticket revenue"
      />

      {state.status === 'pending' ? (
        <Alert tone="warning" title="Under review">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            We&rsquo;re verifying the details you submitted
            {state.kyc ? ` on ${formatDateTime(state.kyc.submittedAt)}` : ''}. You can still correct them below until
            they&rsquo;re approved.
          </span>
        </Alert>
      ) : state.status === 'rejected' ? (
        <Alert tone="error" title="Details need changing">
          {state.kyc?.rejectionReason ?? 'Some details could not be verified. Please check them and submit again.'}
        </Alert>
      ) : (
        <Alert tone="info" title="One-time setup">
          No money can be released until these details are verified, so it&rsquo;s worth completing before your first
          event goes live.
        </Alert>
      )}

      <form onSubmit={submit} className="space-y-5">
        <Section icon={<UserRound className="h-4 w-4" />} title="Identity" hint="As printed on your PAN card">
          <Field label="Full name" required error={errors.legalName} className="sm:col-span-2">
            <Input
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              invalid={Boolean(errors.legalName)}
              placeholder="Rahul Sharma"
              autoComplete="name"
            />
          </Field>

          <Field label="PAN number" required error={errors.pan}>
            <Input
              value={form.pan}
              onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
              invalid={Boolean(errors.pan)}
              placeholder="AAAAA0000A"
              maxLength={10}
              className="font-mono uppercase"
            />
          </Field>
        </Section>

        <Section
          icon={<Building2 className="h-4 w-4" />}
          title="Business"
          hint="Used on the invoices we raise for your events"
        >
          <Field label="Business name" required error={errors.businessName}>
            <Input
              value={form.businessName}
              onChange={(e) => setForm({ ...form, businessName: e.target.value })}
              invalid={Boolean(errors.businessName)}
              placeholder="Sharma Events Pvt Ltd"
            />
          </Field>

          <Field
            label="GST number"
            hint="Leave blank if you are not GST registered"
            error={errors.gstin}
          >
            <Input
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
              invalid={Boolean(errors.gstin)}
              placeholder="22AAAAA0000A1Z5"
              maxLength={15}
              className="font-mono uppercase"
            />
          </Field>

          <Field label="Business address" required error={errors.businessAddress} className="sm:col-span-2">
            <Textarea
              value={form.businessAddress}
              onChange={(e) => setForm({ ...form, businessAddress: e.target.value })}
              rows={3}
              placeholder={'Unit 4, Nehru Place\nNew Delhi 110019'}
            />
          </Field>
        </Section>

        <Section
          icon={<Landmark className="h-4 w-4" />}
          title="Bank account"
          hint="Where your ticket revenue is transferred"
        >
          <Field label="Account holder name" required error={errors.accountHolderName} className="sm:col-span-2">
            <Input
              value={form.accountHolderName}
              onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })}
              invalid={Boolean(errors.accountHolderName)}
              placeholder="Exactly as it appears on your bank records"
            />
          </Field>

          <Field label="Account number" required error={errors.accountNumber}>
            <Input
              value={form.accountNumber}
              onChange={(e) => setForm({ ...form, accountNumber: e.target.value.replace(/\D/g, '') })}
              invalid={Boolean(errors.accountNumber)}
              inputMode="numeric"
              maxLength={18}
              className="font-mono"
              autoComplete="off"
            />
          </Field>

          <Field label="Re-enter account number" required error={errors.confirmAccountNumber}>
            <Input
              value={form.confirmAccountNumber}
              onChange={(e) => setForm({ ...form, confirmAccountNumber: e.target.value.replace(/\D/g, '') })}
              invalid={Boolean(errors.confirmAccountNumber)}
              inputMode="numeric"
              maxLength={18}
              className="font-mono"
              autoComplete="off"
              onPaste={(e) => e.preventDefault()}
            />
          </Field>

          <Field label="IFSC code" required error={errors.ifsc}>
            <Input
              value={form.ifsc}
              onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })}
              invalid={Boolean(errors.ifsc)}
              placeholder="HDFC0001234"
              maxLength={11}
              className="font-mono uppercase"
            />
          </Field>

          <Field label="Bank name" hint="Optional">
            <Input
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              placeholder="HDFC Bank"
            />
          </Field>
        </Section>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" loading={saving}>
            <ShieldCheck className="h-4 w-4" />
            {isResubmission ? 'Submit again for review' : 'Submit for verification'}
          </Button>
          {state.kyc && (
            <span className="text-xs text-ink-500">
              Last submitted {formatDateTime(state.kyc.submittedAt)} · <StatusBadge status={state.status} />
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-ink-400">{icon}</span>
        <h2 className="text-base font-bold text-ink-900">{title}</h2>
      </div>
      <p className="mb-5 text-xs text-ink-500">{hint}</p>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
