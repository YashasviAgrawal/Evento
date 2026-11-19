import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BadgePercent, Clock3, IndianRupee, MapPin, Navigation, Phone, ReceiptText, Star, Wallet } from 'lucide-react';
import { fetchPublic } from '@tixit/session';
import type { Offer, RestaurantDetail } from '@/lib/types';
import { clock, cn, humanTag, rupees } from '@/lib/format';
import { directionsUrl } from '@/lib/urls';
import { Gallery } from '@/components/restaurant/gallery';
import { OpenDot, RatingPill } from '@/components/restaurant/bits';
import { DesktopBookingCard, MobileBookingDock } from '@/components/restaurant/booking-launcher';
import { ShareButton } from '@/components/restaurant/share-button';

type Props = { params: Promise<{ slug: string }> };

const getRestaurant = (slug: string) => fetchPublic<RestaurantDetail>(`/dining/restaurants/${slug}`, undefined, 60);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const restaurant = await getRestaurant((await params).slug);
  if (!restaurant) return { title: 'Restaurant not found' };
  const offer = restaurant.bestOffer ? ` · ${restaurant.bestOffer.label}` : '';
  return {
    title: `${restaurant.name}, ${restaurant.locality}${offer}`,
    description: `${restaurant.cuisines.join(', ')} in ${restaurant.locality}, ${restaurant.city.name}. ${rupees(restaurant.costForTwoPaise)} for two. Book a table and pay your bill on Tixit.`,
    alternates: { canonical: `/r/${restaurant.slug}` },
    openGraph: { images: restaurant.coverUrl ? [restaurant.coverUrl] : undefined },
  };
}

const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function OfferCard({ offer, highlight }: { offer: Offer; highlight?: boolean }) {
  const value = offer.kind === 'percent' ? `${offer.percentOff}% off` : `${rupees(offer.flatOffPaise ?? 0)} off`;
  const label = offer.appliesTo === 'prebook' ? 'Pre-book' : offer.appliesTo === 'walkin' ? 'Walk-in · Pay bill' : 'Pre-book or walk-in';
  return (
    <div
      className={cn(
        'rounded-2xl p-4 ring-1 ring-inset',
        highlight ? 'bg-gradient-to-br from-save-50 to-white ring-2 ring-save-500' : 'bg-white ring-ink-200',
      )}
    >
      <p className={cn('eyebrow', highlight ? 'text-save-700' : 'text-ink-400')}>{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-save-700">{value}</p>
      <p className="mt-1 text-[13px] font-semibold text-ink-800">{offer.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        {offer.schedule}
        {offer.minBillPaise > 0 && ` · on bills over ${rupees(offer.minBillPaise)}`}
        {offer.maxDiscountPaise ? ` · up to ${rupees(offer.maxDiscountPaise)}` : ''}
      </p>
      {offer.terms && <p className="mt-1 text-xs text-ink-400">{offer.terms}</p>}
    </div>
  );
}

export default async function RestaurantPage({ params }: Props) {
  const restaurant = await getRestaurant((await params).slug);
  if (!restaurant) notFound();

  const prebook = restaurant.offers.filter((o) => o.appliesTo !== 'walkin');
  const walkin = restaurant.offers.filter((o) => o.appliesTo !== 'prebook');
  const photos = [restaurant.coverUrl, ...restaurant.gallery.map((g) => g.url)].filter((url): url is string => Boolean(url));
  const totalReviews = restaurant.ratingDistribution.reduce((sum, row) => sum + row.count, 0);
  const todayIndex = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  const launcher = {
    restaurant: {
      slug: restaurant.slug,
      name: restaurant.name,
      lat: restaurant.lat,
      lng: restaurant.lng,
      bookingEnabled: restaurant.bookingEnabled,
      payBillEnabled: restaurant.payBillEnabled,
    },
    bestOfferLabel: prebook[0] ? (prebook[0].kind === 'percent' ? `${prebook[0].percentOff}% off` : `${rupees(prebook[0].flatOffPaise ?? 0)} off`) : null,
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: restaurant.name,
    image: photos.slice(0, 3),
    servesCuisine: restaurant.cuisines,
    priceRange: `${rupees(restaurant.costForTwoPaise)} for two`,
    telephone: restaurant.phone ?? undefined,
    address: { '@type': 'PostalAddress', streetAddress: restaurant.address, addressLocality: restaurant.city.name, addressCountry: 'IN' },
    geo: { '@type': 'GeoCoordinates', latitude: restaurant.lat, longitude: restaurant.lng },
    aggregateRating: restaurant.ratingCount
      ? { '@type': 'AggregateRating', ratingValue: restaurant.rating, reviewCount: restaurant.ratingCount }
      : undefined,
    acceptsReservations: restaurant.bookingEnabled,
  };

  return (
    <div className="pb-28 md:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Gallery name={restaurant.name} photos={photos} />

      <div className="container-page relative -mt-6 md:mt-8">
        <div className="grid gap-8 md:grid-cols-[1fr_380px] lg:gap-12">
          <div className="min-w-0 rounded-t-[28px] bg-ink-50 pt-5 md:rounded-none md:pt-0">
            {/* ── identity ── */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-[28px] font-black leading-tight tracking-tight sm:text-4xl">{restaurant.name}</h1>
                <p className="mt-1 text-[15px] text-ink-600">{restaurant.cuisines.join(' · ')}</p>
                <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-500">
                  <MapPin className="h-3.5 w-3.5" aria-hidden /> {restaurant.locality}, {restaurant.city.name}
                </p>
              </div>
              <div className="shrink-0 text-center">
                <span className="inline-flex items-center gap-1 rounded-xl bg-save-600 px-2.5 py-1.5 text-base font-black text-white">
                  {restaurant.rating ? restaurant.rating.toFixed(1) : 'New'} <Star className="h-3.5 w-3.5 fill-white stroke-none" />
                </span>
                <p className="mt-1 text-[11px] text-ink-500">{restaurant.ratingCount.toLocaleString('en-IN')} ratings</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <OpenDot open={restaurant.openNow} closesAt={restaurant.closesAt} />
              {!restaurant.openNow && restaurant.opensAt && <span className="text-xs text-ink-500">Opens {clock(restaurant.opensAt)}</span>}
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-600">
                <IndianRupee className="h-3.5 w-3.5" aria-hidden /> {rupees(restaurant.costForTwoPaise)} for two
              </span>
            </div>

            <div className="mt-4 flex gap-2">
              <a
                href={directionsUrl(restaurant.lat, restaurant.lng, restaurant.name)}
                target="_blank"
                rel="noreferrer"
                className="press inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold ring-1 ring-inset ring-ink-200 hover:ring-ink-300"
              >
                <Navigation className="h-4 w-4" /> Directions
              </a>
              {restaurant.phone && (
                <a
                  href={`tel:${restaurant.phone.replace(/\s/g, '')}`}
                  className="press inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold ring-1 ring-inset ring-ink-200 hover:ring-ink-300"
                >
                  <Phone className="h-4 w-4" /> Call
                </a>
              )}
              <ShareButton
                title={restaurant.name}
                className="press grid h-10 w-10 place-items-center rounded-full bg-white ring-1 ring-inset ring-ink-200 hover:ring-ink-300"
              />
            </div>

            {/* ── offers ── */}
            {restaurant.offers.length > 0 && (
              <section className="mt-8" aria-labelledby="offers">
                <h2 id="offers" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
                  <BadgePercent className="h-5 w-5 text-save-600" aria-hidden /> Offers
                </h2>
                <p className="mt-0.5 text-sm text-ink-500">Applied automatically when you pay the bill on Tixit.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {prebook[0] && <OfferCard offer={prebook[0]} highlight />}
                  {walkin.find((o) => o.id !== prebook[0]?.id) && <OfferCard offer={walkin.find((o) => o.id !== prebook[0]?.id)!} />}
                </div>
                {restaurant.offers.length > 2 && (
                  <details className="group mt-3">
                    <summary className="cursor-pointer list-none text-sm font-bold text-brand-600">
                      <span className="group-open:hidden">See all {restaurant.offers.length} offers</span>
                      <span className="hidden group-open:inline">Show fewer</span>
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {restaurant.offers.slice(2).map((offer) => (
                        <OfferCard key={offer.id} offer={offer} />
                      ))}
                    </div>
                  </details>
                )}
              </section>
            )}

            {/* ── pay bill promo ── */}
            {restaurant.payBillEnabled && (
              <Link
                href={`/pay/${restaurant.slug}`}
                className="press mt-6 hidden items-center justify-between gap-4 rounded-3xl bg-ink-900 p-5 text-white md:flex"
              >
                <span className="flex items-center gap-4">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10">
                    <ReceiptText className="h-6 w-6" />
                  </span>
                  <span>
                    <span className="block font-bold">Already at the table?</span>
                    <span className="block text-sm text-ink-300">Pay your bill on Tixit — offers apply instantly.</span>
                  </span>
                </span>
                <span className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-ink-900">Pay bill</span>
              </Link>
            )}

            {/* ── about ── */}
            <section className="mt-8">
              <h2 className="text-lg font-extrabold tracking-tight">About</h2>
              {restaurant.description && <p className="mt-2 text-[15px] leading-relaxed text-ink-700">{restaurant.description}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {restaurant.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/restaurants?tag=${tag}`}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-200 hover:ring-ink-300"
                  >
                    {humanTag(tag)}
                  </Link>
                ))}
              </div>

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white p-4 ring-1 ring-ink-200">
                  <dt className="flex items-center gap-2 text-sm font-bold">
                    <MapPin className="h-4 w-4 text-ink-400" /> Address
                  </dt>
                  <dd className="mt-1 text-sm leading-relaxed text-ink-600">{restaurant.address}</dd>
                </div>
                <div className="rounded-2xl bg-white p-4 ring-1 ring-ink-200">
                  <dt className="flex items-center gap-2 text-sm font-bold">
                    <Wallet className="h-4 w-4 text-ink-400" /> Service charge
                  </dt>
                  <dd className="mt-1 text-sm leading-relaxed text-ink-600">
                    {restaurant.serviceChargePercent > 0
                      ? `${restaurant.serviceChargePercent}% — always optional, never discounted, your choice at payment.`
                      : 'None. What you see is what you pay.'}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 rounded-2xl bg-white p-4 ring-1 ring-ink-200">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <Clock3 className="h-4 w-4 text-ink-400" /> Opening hours
                </p>
                <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2 sm:gap-x-8">
                  {WEEK.map((day, index) => {
                    const shifts = restaurant.hours[String(index)] ?? [];
                    const today = day === todayIndex;
                    return (
                      <li key={day} className={cn('flex justify-between gap-4 py-0.5', today ? 'font-bold text-ink-900' : 'text-ink-600')}>
                        <span>{today ? 'Today' : day}</span>
                        <span className="num text-right">
                          {shifts.length ? shifts.map(([open, close]) => `${clock(open)}–${clock(close)}`).join(', ') : 'Closed'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>

            {/* ── reviews ── */}
            <section className="mt-8">
              <h2 className="text-lg font-extrabold tracking-tight">What diners say</h2>
              <p className="mt-0.5 text-sm text-ink-500">Only people who paid their bill on Tixit can review.</p>
              {totalReviews > 0 && (
                <div className="mt-4 grid gap-4 rounded-2xl bg-white p-4 ring-1 ring-ink-200 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8">
                  <div className="text-center">
                    <p className="text-4xl font-black tracking-tight">{restaurant.rating.toFixed(1)}</p>
                    <RatingPill rating={restaurant.rating} className="justify-center" />
                  </div>
                  <ul className="space-y-1">
                    {restaurant.ratingDistribution.map((row) => (
                      <li key={row.stars} className="flex items-center gap-2 text-xs">
                        <span className="w-3 text-ink-500">{row.stars}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                          <span className="block h-full rounded-full bg-save-500" style={{ width: `${(row.count / totalReviews) * 100}%` }} />
                        </span>
                        <span className="num w-6 text-right text-ink-400">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {restaurant.reviews.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {restaurant.reviews.map((review, index) => (
                    <li key={index} className="rounded-2xl bg-white p-4 ring-1 ring-ink-200">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold">{review.author}</span>
                        <RatingPill rating={review.rating} />
                      </div>
                      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-save-700">Verified diner</p>
                      {review.body && <p className="mt-2 text-sm leading-relaxed text-ink-700">{review.body}</p>}
                      {review.reply && (
                        <p className="mt-3 rounded-xl bg-ink-50 p-3 text-sm text-ink-600">
                          <span className="font-bold text-ink-800">Reply from {restaurant.name}: </span>
                          {review.reply}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 rounded-2xl bg-white p-4 text-sm text-ink-500 ring-1 ring-ink-200">No written reviews yet.</p>
              )}
            </section>
          </div>

          {/* ── desktop booking column ── */}
          <aside className="hidden md:block">
            <div className="sticky top-24 space-y-3">
              {restaurant.bookingEnabled && (
                <Suspense>
                  <DesktopBookingCard {...launcher} />
                </Suspense>
              )}
              {restaurant.payBillEnabled && (
                <Link
                  href={`/pay/${restaurant.slug}`}
                  className="press flex h-12 items-center justify-center gap-2 rounded-2xl bg-ink-900 text-sm font-bold text-white"
                >
                  <ReceiptText className="h-4 w-4" /> Pay your bill
                </Link>
              )}
            </div>
          </aside>
        </div>
      </div>

      <Suspense>
        <MobileBookingDock {...launcher} />
      </Suspense>
    </div>
  );
}
