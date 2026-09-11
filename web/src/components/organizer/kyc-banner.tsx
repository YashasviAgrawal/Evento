'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import type { KycState } from '@/lib/types';
import { Alert } from '@/components/ui/index';
import { ButtonLink } from '@/components/ui/button';

/**
 * The nag that follows a new organizer around the dashboard until their payout
 * details are verified.
 *
 * It is a banner rather than a hard redirect on purpose: an organizer should be
 * able to look around and start building an event before handing over a bank
 * account. The gate that actually matters is on the money — no payout can be
 * recorded against an organizer whose KYC is not approved.
 */
export function KycBanner() {
  const pathname = usePathname();
  const [state, setState] = useState<KycState | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<KycState>('/organizer/kyc')
      .then(({ data }) => {
        if (active) setState(data);
      })
      .catch(() => {
        // An admin browsing the organizer console has no organizer profile of
        // their own; there is simply nothing to prompt about.
        if (active) setState(null);
      });
    return () => {
      active = false;
    };
  }, []);

  // The KYC page says all of this itself, at more length.
  if (!state || state.status === 'approved' || pathname === '/organizer/kyc') return null;

  const copy = {
    not_submitted: {
      tone: 'warning' as const,
      title: 'Add your payout details',
      body: 'We need your PAN, business details and bank account before any ticket revenue can be released to you.',
      cta: 'Complete KYC',
    },
    pending: {
      tone: 'info' as const,
      title: 'Payout details under review',
      body: 'Our team is verifying the details you submitted. Payouts start once they are approved.',
      cta: 'View submission',
    },
    rejected: {
      tone: 'error' as const,
      title: 'Your payout details need changing',
      body: state.kyc?.rejectionReason ?? 'Some details could not be verified. Correct them and submit again.',
      cta: 'Fix details',
    },
  }[state.status];

  return (
    <Alert tone={copy.tone} title={copy.title} className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{copy.body}</span>
        <ButtonLink href="/organizer/kyc" size="sm" variant="outline">
          {copy.cta}
        </ButtonLink>
      </div>
    </Alert>
  );
}
