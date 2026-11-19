import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SharePay } from '@/components/pay/share-pay';

// A share link is private to whoever was sent it.
export const metadata: Metadata = { title: 'Your share of the bill', robots: { index: false, follow: false } };

export default async function SplitSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <Suspense>
      <SharePay token={token} />
    </Suspense>
  );
}
