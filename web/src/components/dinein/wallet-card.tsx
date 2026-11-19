'use client';

import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { dineinUrl } from '@/lib/dinein';
import { formatMoney } from '@/lib/format';

/** The Tixit Wallet belongs to the account, so the events app shows it too. */
export function WalletCard() {
  const [wallet, setWallet] = useState<{ availablePaise: number; pendingPaise: number } | null>(null);
  useEffect(() => {
    api.get<{ availablePaise: number; pendingPaise: number }>('/wallet').then(({ data }) => setWallet(data)).catch(() => setWallet(null));
  }, []);
  if (!wallet) return null;
  return (
    <a
      href={dineinUrl('/wallet')}
      className="flex items-center gap-4 rounded-xl bg-ink-950 p-5 text-white shadow-card transition hover:shadow-lift"
    >
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10">
        <Wallet className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold uppercase tracking-wider text-brand-300">Tixit Wallet</span>
        <span className="block text-2xl font-extrabold">{formatMoney(wallet.availablePaise)}</span>
        <span className="block text-xs text-ink-300">
          {wallet.pendingPaise > 0 ? `${formatMoney(wallet.pendingPaise)} cashback on the way · ` : ''}Spend it on dine-in bills
        </span>
      </span>
      <span className="text-sm font-semibold text-ink-300">Open →</span>
    </a>
  );
}
