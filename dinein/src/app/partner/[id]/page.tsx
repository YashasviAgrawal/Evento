'use client';

import { use } from 'react';
import { LiveBoard } from '@/components/partner/live-board';

export default function PartnerLivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <LiveBoard restaurantId={id} />;
}
