import Link from 'next/link';
import { ArrowRight, BadgePercent, CalendarClock, Music2, Leaf, Search, ShieldCheck, Sparkles, Sunset, Wine, Zap } from 'lucide-react';
import { fetchPublic } from '@tixit/session';
import type { HomeFeed } from '@/lib/types';
import { SiteHeader } from '@/components/shell/site-header';
import { Footer } from '@/components/shell/footer';
import { Photo } from '@/components/ui/photo';
import { Rail, RailCard, RestaurantCard } from '@/components/restaurant/restaurant-card';
import { EmptyState } from '@/components/ui/feedback';
import { CityPicker } from '@/components/shell/city-picker';
import { currentCity } from '@/lib/city.server';


const INTENTS = [
  { href: '/restaurants?openNow=1&sort=offer', label: 'Tonight', icon: Zap },
  { href: '/pay', label: 'Pay bill', icon: BadgePercent },
  { href: '/restaurants?tag=rooftop', label: 'Rooftop', icon: Sunset },
  { href: '/restaurants?tag=date-night', label: 'Date night', icon: Sparkles },
  { href: '/restaurants?tag=bar', label: 'Bars', icon: Wine },
  { href: '/restaurants?tag=pure-veg', label: 'Pure veg', icon: Leaf },
  { href: '/restaurants?tag=live-music', label: 'Live music', icon: Music2 },
];

const STEPS = [
  { n: '01', title: 'Book a table', body: 'Pick a time — each slot shows the offer you lock in.', icon: CalendarClock },
  { n: '02', title: 'Dine as usual', body: 'Order whatever you like. No vouchers to show, no app to wave around.', icon: Sparkles },
  { n: '03', title: 'Pay the bill here', body: 'Enter the amount. Offers apply themselves — you see every rupee saved before paying.', icon: ShieldCheck },
];

export default async function HomePage() {
  const citySlug = await currentCity();
  const response = await fetchPublic<HomeFeed>('/dining/home', { city: citySlug }, 60);
  // A city with nothing live yet gets the friendly empty state, never "0 restaurants".
  const feed = response && response.restaurantCount > 0 ? response : null;
  const deepestPercent = Math.max(0, ...(feed?.bestOffers ?? []).map((card) => card.bestOffer?.percentOff ?? 0));

  return (
    <>
      <section className="night pb-14 sm:pb-20">
        <SiteHeader tone="night" />
        <div className="container-page pt-6 sm:pt-12">
          <CityPicker current={response?.city ?? { name: 'Jaipur', slug: citySlug }} />
          <h1 className="mt-3 max-w-3xl text-[34px] font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Where are we
            <br />
            <span className="bg-gradient-to-r from-brand-400 to-brand-600 bg-clip-text text-transparent">eating tonight?</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-300 sm:text-lg">
            Book a table, pay the bill in the app, and watch the savings land before you tap pay.
          </p>

          <form action="/restaurants" role="search" className="mt-7 max-w-2xl">
            <label className="flex items-center gap-3 rounded-2xl bg-white p-2 pl-4 shadow-lift">
              <Search className="h-5 w-5 shrink-0 text-ink-400" aria-hidden />
              <input
                name="q"
                placeholder="Restaurants, cuisines, dishes…"
                className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
                aria-label="Search restaurants"
              />
              <button className="press h-11 shrink-0 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white shadow-glow hover:bg-brand-700">
                Search
              </button>
            </label>
          </form>

          <div className="scrollbar-none -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            {INTENTS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="glass press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold text-white hover:bg-white/15"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </Link>
            ))}
          </div>

          {feed && (
            <dl className="mt-9 grid max-w-xl grid-cols-3 gap-3 text-center sm:text-left">
              {[
                [`${feed.restaurantCount}`, 'restaurants live'],
                ['10 sec', 'to pay a bill'],
                deepestPercent > 0 ? [`Up to ${deepestPercent}%`, 'off, shown upfront'] : ['0%', 'mandatory service charge'],
              ].map(([value, label]) => (
                <div key={label} className="glass rounded-2xl px-3 py-3 sm:px-4">
                  <dt className="sr-only">{label}</dt>
                  <dd className="text-lg font-extrabold tracking-tight sm:text-2xl">{value}</dd>
                  <dd className="text-[11px] font-medium text-ink-300 sm:text-xs">{label}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      {!feed ? (
        <div className="container-page mt-10">
          <EmptyState
            icon={Search}
            title={response ? 'Restaurants are coming soon' : 'We couldn’t load restaurants'}
            body={response ? 'We’re signing up the best tables in town. Check back shortly.' : 'Our kitchen is a little busy. Please refresh in a moment.'}
          />
        </div>
      ) : (
        <>
          {feed.tonight.length > 0 && (
            <section className="container-page mt-8 sm:mt-12">
              <div>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="eyebrow text-brand-600">Live availability</p>
                    <h2 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">Tables tonight</h2>
                  </div>
                  <Link href="/restaurants?openNow=1" className="text-sm font-bold text-brand-600 hover:text-brand-700">
                    See all
                  </Link>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {feed.tonight.slice(0, 6).map((card, index) => (
                    <RestaurantCard key={card.id} card={card} priority={index < 2} />
                  ))}
                </div>
              </div>
            </section>
          )}

          {feed.collections.length > 0 && (
            <Rail title="Collections" subtitle="Hand-picked for the way you go out">
              {feed.collections.map((collection) => (
                <Link key={collection.slug} href={`/collections/${collection.slug}`} className="group block w-[220px] shrink-0 snap-start sm:w-[260px]">
                  <Photo src={collection.coverUrl} alt={collection.title} sizes="260px" className="aspect-[4/5] rounded-3xl">
                    <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/20 to-transparent" />
                    <div className="absolute inset-x-4 bottom-4 text-white">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-brand-300">{collection.count} places</p>
                      <h3 className="mt-1 text-lg font-extrabold leading-tight">{collection.title}</h3>
                      {collection.subtitle && <p className="mt-1 line-clamp-2 text-xs text-white/75">{collection.subtitle}</p>}
                    </div>
                  </Photo>
                </Link>
              ))}
            </Rail>
          )}

          {feed.bestOffers.length > 0 && (
            <Rail title="Biggest savings" subtitle="The deepest offers in the city right now" href="/restaurants?sort=offer">
              {feed.bestOffers.map((card) => (
                <RailCard key={card.id} card={card} />
              ))}
            </Rail>
          )}

          <section className="container-page mt-12">
            <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">Craving something?</h2>
            <div className="scrollbar-none -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
              {feed.cuisines.map((cuisine) => (
                <Link
                  key={cuisine.name}
                  href={`/restaurants?cuisine=${encodeURIComponent(cuisine.name)}`}
                  className="press inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-ink-800 ring-1 ring-inset ring-ink-200 hover:ring-ink-300"
                >
                  {cuisine.name}
                  <span className="num rounded-full bg-ink-100 px-1.5 text-[11px] font-bold text-ink-500">{cuisine.count}</span>
                </Link>
              ))}
            </div>
          </section>

          {feed.topRated.length > 0 && (
            <Rail title="Loved by diners" subtitle="Rated highest by people who paid on Tixit" href="/restaurants?sort=rating">
              {feed.topRated.map((card) => (
                <RailCard key={card.id} card={card} />
              ))}
            </Rail>
          )}

          <section className="container-page mt-14">
            <div className="night rounded-[32px] p-6 sm:p-10">
              <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:items-center">
                <div>
                  <p className="eyebrow text-brand-300">How Tixit Dine-in works</p>
                  <h2 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight sm:text-4xl">
                    The bill is where
                    <br />
                    you save.
                  </h2>
                  <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-300">
                    Offers apply automatically when you pay through Tixit. Service charge stays optional, and every
                    discount says who is paying for it.
                  </p>
                  <Link
                    href="/pay"
                    className="press mt-6 inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-bold text-ink-900"
                  >
                    Pay a bill now <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
                <ol className="grid gap-3 sm:grid-cols-3">
                  {STEPS.map(({ n, title, body, icon: Icon }) => (
                    <li key={n} className="glass rounded-2xl p-4">
                      <div className="flex items-center justify-between">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600/90 text-white">
                          <Icon className="h-4.5 w-4.5" aria-hidden />
                        </span>
                        <span className="num text-xs font-bold text-ink-400">{n}</span>
                      </div>
                      <h3 className="mt-4 font-bold">{title}</h3>
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-300">{body}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>

          <section className="container-page mt-10">
            <Link
              href="/partner"
              className="group flex flex-col items-start justify-between gap-4 rounded-3xl bg-white p-6 ring-1 ring-ink-200 transition hover:shadow-lift sm:flex-row sm:items-center"
            >
              <div>
                <p className="eyebrow text-ink-400">For restaurants</p>
                <h2 className="mt-1 text-lg font-extrabold tracking-tight">Run your Tixit tables and payments from one screen</h2>
                <p className="mt-1 text-sm text-ink-500">Live payments with one-tap verification, bookings, offers and payouts.</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-brand-600 group-hover:gap-2.5">
                Open partner console <ArrowRight className="h-4 w-4 transition-all" />
              </span>
            </Link>
          </section>
        </>
      )}

      <Footer />
    </>
  );
}
