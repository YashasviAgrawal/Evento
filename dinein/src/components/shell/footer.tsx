import Link from 'next/link';
import { EVENTS_URL } from '@/lib/urls';
import { Wordmark } from './site-header';

export function Footer() {
  return (
    <footer className="mt-20 hidden border-t border-ink-200 bg-white md:block">
      <div className="container-page flex flex-wrap items-start justify-between gap-8 py-10">
        <div className="max-w-xs">
          <Wordmark />
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            Book a table, pay the bill in the app, and keep the savings. One Tixit account for events and dining.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
          <Link href="/restaurants" className="text-ink-600 hover:text-ink-900">Restaurants</Link>
          <a href={`${EVENTS_URL}/about`} className="text-ink-600 hover:text-ink-900">About Tixit</a>
          <Link href="/pay" className="text-ink-600 hover:text-ink-900">Pay your bill</Link>
          <a href={`${EVENTS_URL}/terms`} className="text-ink-600 hover:text-ink-900">Terms</a>
          <Link href="/partner" className="text-ink-600 hover:text-ink-900">For restaurants</Link>
          <a href={`${EVENTS_URL}/privacy`} className="text-ink-600 hover:text-ink-900">Privacy</a>
          <a href={EVENTS_URL} className="text-ink-600 hover:text-ink-900">Tixit Events</a>
          <a href={`${EVENTS_URL}/support`} className="text-ink-600 hover:text-ink-900">Support</a>
        </div>
      </div>
      <div className="border-t border-ink-100 py-5 text-center text-xs text-ink-400">
        © {new Date().getFullYear()} Tixit · Service charge on Tixit is always optional and never discounted.
      </div>
    </footer>
  );
}
