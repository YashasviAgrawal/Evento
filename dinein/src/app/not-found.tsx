import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { SiteHeader } from '@/components/shell/site-header';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="container-page grid min-h-[60vh] place-items-center py-16 text-center">
        <div>
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-brand-600">
            <UtensilsCrossed className="h-8 w-8" />
          </span>
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight">This table doesn’t exist</h1>
          <p className="mt-1.5 text-ink-500">The page may have moved, or the restaurant is no longer on Tixit.</p>
          <Link href="/restaurants" className="press mt-6 inline-flex h-12 items-center rounded-2xl bg-ink-900 px-6 font-bold text-white">
            Find a restaurant
          </Link>
        </div>
      </main>
    </>
  );
}
