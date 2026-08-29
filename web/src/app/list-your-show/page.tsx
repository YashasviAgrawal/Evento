import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeIndianRupee,
  BarChart3,
  Baby,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Drama,
  GraduationCap,
  Headphones,
  Mail,
  Megaphone,
  Mic,
  MapPin,
  Music,
  Palette,
  PartyPopper,
  Phone,
  Presentation,
  QrCode,
  Sparkles,
  Tag,
  Ticket,
  Trophy,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { fetchPublic } from '@/lib/api';
import type { Category, City } from '@/lib/types';
import { ButtonLink } from '@/components/ui/button';
import { ListYourShowForm } from '@/components/organizer/list-your-show-form';

export const revalidate = 3600;

const TITLE = 'List Your Show';
const DESCRIPTION =
  'Got a concert, comedy night, workshop, match or festival? List your show on Tixit and start selling tickets in minutes — secure payments, QR check-in, real-time sales and fast payouts.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'list your show',
    'list your event',
    'sell tickets online',
    'event ticketing India',
    'event organizer platform',
    'online ticket booking partner',
  ],
  alternates: { canonical: '/list-your-show' },
  openGraph: {
    title: `${TITLE} on Tixit`,
    description: DESCRIPTION,
    url: '/list-your-show',
  },
};

/* ─────────────────────────────── content ─────────────────────────────── */

const HERO_STATS = [
  { value: 'Under 10 min', label: 'to publish a listing' },
  { value: '0₹', label: 'setup or monthly fee' },
  { value: 'T+3 days', label: 'typical payout after the event' },
];

const BENEFITS: Array<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: Users,
    title: 'Put your show in front of buyers',
    description:
      'Your listing lands on the Tixit homepage, in category and city browsing, and in search — so people already looking for a night out find you.',
  },
  {
    icon: Ticket,
    title: 'Ticket tiers that fit your show',
    description:
      'Early bird, VIP, couple, group and free passes — each with its own price, inventory and per-booking limit. Change them any time before you sell out.',
  },
  {
    icon: CreditCard,
    title: 'Payments handled end to end',
    description:
      'UPI, cards and net banking through Razorpay. Every booking is reconciled automatically, so you never chase a payment yourself.',
  },
  {
    icon: QrCode,
    title: 'Entry that actually moves',
    description:
      'Every ticket carries a signed, single-use QR code. Scan with any phone at the door — no scanner hardware, no printed guest list, no duplicate entries.',
  },
  {
    icon: BarChart3,
    title: 'Sales you can watch live',
    description:
      'Revenue, sell-through by tier and attendance update in real time, and everything exports to CSV when you need it for your own books.',
  },
  {
    icon: Megaphone,
    title: 'Promo codes and campaigns',
    description:
      'Run discount codes for partners, press or early supporters, cap their usage, and see exactly which ones brought the sales in.',
  },
  {
    icon: BadgeIndianRupee,
    title: 'Straightforward payouts',
    description:
      'A flat commission on tickets sold, itemised per booking in your dashboard. No setup fee, no monthly charge, no surprise line items.',
  },
  {
    icon: Headphones,
    title: 'A team you can reach',
    description:
      'Onboarding help when you list, and someone to call on event day if anything at the door needs sorting out.',
  },
];

const STEPS = [
  {
    title: 'Tell us about your show',
    description: 'Send an enquiry or create an organizer account directly — whichever suits you.',
  },
  {
    title: 'Get verified',
    description: 'We check your details and payout account, usually within one business day.',
  },
  {
    title: 'Build the listing',
    description: 'Add your artwork, schedule, venue and ticket tiers in the organizer dashboard.',
  },
  {
    title: 'Go live and sell',
    description: 'We review and publish it. Your show appears in search, browsing and on the homepage.',
  },
  {
    title: 'Scan them in, get paid',
    description: 'Check attendees in with the QR scanner, then receive your payout after the event.',
  },
];

/** Matches the icon names seeded onto `categories.icon`, same map the home page uses. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Music,
  Mic,
  GraduationCap,
  Trophy,
  Drama,
  Presentation,
  PartyPopper,
  UtensilsCrossed,
  Palette,
  Baby,
};

/** Shown when the catalog API is unreachable, so the section never renders empty. */
const FALLBACK_CATEGORIES = [
  { name: 'Music & concerts', icon: 'Music' },
  { name: 'Comedy', icon: 'Mic' },
  { name: 'Workshops', icon: 'GraduationCap' },
  { name: 'Sports', icon: 'Trophy' },
  { name: 'Theatre', icon: 'Drama' },
  { name: 'Conferences', icon: 'Presentation' },
  { name: 'Parties & nightlife', icon: 'PartyPopper' },
  { name: 'Food & drink', icon: 'UtensilsCrossed' },
  { name: 'Art & exhibitions', icon: 'Palette' },
  { name: 'Kids & family', icon: 'Baby' },
];

const DASHBOARD_FEATURES = [
  'Unlimited events and ticket tiers',
  'Free events with RSVP-style registration',
  'Discount and promo codes with usage caps',
  'Real-time sales and revenue dashboard',
  'QR scanner that works on any phone',
  'Attendee lists and CSV exports',
  'Refund handling with a clear approval trail',
  'Booking-level payout reconciliation',
];

const FAQS = [
  {
    question: 'What does it cost to list on Tixit?',
    answer:
      'Nothing upfront. There is no setup fee and no monthly charge — we take a flat 10% commission on ticket revenue, which is negotiable at volume. Free events cost you nothing at all.',
  },
  {
    question: 'How long does it take to get my show live?',
    answer:
      'Verification usually finishes within one business day. Once you are verified, building the listing takes a few minutes, and our team reviews and publishes submitted events quickly.',
  },
  {
    question: 'What kinds of events can I list?',
    answer:
      'Concerts, comedy nights, theatre, workshops, conferences, sports, food and drink events, exhibitions, kids and family shows, parties and more. If you are not sure whether yours fits, send us an enquiry and ask.',
  },
  {
    question: 'When do I get paid?',
    answer:
      'Ticket revenue minus the platform commission is reconciled per booking in your dashboard as sales come in, and paid out to your registered account after the event — typically within three business days.',
  },
  {
    question: 'Do I need special hardware to check people in?',
    answer:
      'No. The Scan Tickets tool in your organizer dashboard runs in any phone browser. Each QR code is signed and single-use, so duplicates and forgeries are declined automatically.',
  },
  {
    question: 'Can I sell tickets somewhere else at the same time?',
    answer:
      'Yes. You control the inventory you allocate to each Tixit ticket tier, so you can hold back seats for the door or another channel.',
  },
  {
    question: 'What happens if I have to cancel or reschedule?',
    answer:
      'Update the event from your dashboard and we notify ticket holders by email. Cancelled events are automatically eligible for full refunds under our Refund Policy.',
  },
];

/* ──────────────────────────────── page ──────────────────────────────── */

function CategoryIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && CATEGORY_ICONS[name]) || Tag;
  return <Icon className={className} aria-hidden />;
}

export default async function ListYourShowPage() {
  const [categories, cities] = await Promise.all([
    fetchPublic<Category[]>('/catalog/categories', undefined, 3600),
    fetchPublic<City[]>('/catalog/cities', undefined, 3600),
  ]);

  const categoryChips =
    categories && categories.length > 0
      ? categories.map((category) => ({ name: category.name, icon: category.icon }))
      : FALLBACK_CATEGORIES;

  /* An FAQPage block makes these answers eligible for rich results, which is
     where organizers comparing platforms tend to start. */
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-ink-950">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-600/30 blur-3xl" />
          <div className="absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(225,29,72,0.15),transparent_55%)]" />
        </div>

        <div className="container-page relative py-16 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              For organizers, venues and promoters
            </span>

            <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
              List your show,{' '}
              <span className="bg-gradient-to-r from-brand-400 to-brand-600 bg-clip-text text-transparent">
                fill your room
              </span>
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-300 sm:text-lg">
              Got a concert, comedy night, workshop, match or festival? Put it on Tixit and start selling tickets in
              minutes — with secure payments, QR check-in and sales you can watch in real time.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/auth/register?role=organizer" size="lg">
                Start selling tickets
              </ButtonLink>
              <ButtonLink
                href="#enquiry"
                size="lg"
                variant="outline"
                className="border-white/30 bg-transparent text-white hover:bg-white/10"
              >
                Talk to our team
              </ButtonLink>
            </div>
          </div>

          <dl className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
            {HERO_STATS.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-center backdrop-blur"
              >
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="block text-2xl font-extrabold tracking-tight text-white">{stat.value}</span>
                  <span className="mt-0.5 block text-xs text-ink-400">{stat.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── What you can list ── */}
      <section className="container-page py-14">
        <div className="mb-7 max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">What you can list</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
            If people buy a ticket for it, it belongs here
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            One listing flow covers every format — a 60-seat workshop and a 5,000-capacity festival are set up exactly
            the same way.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {categoryChips.map((chip) => (
            <div
              key={chip.name}
              className="flex items-center gap-2.5 rounded-xl border border-ink-200 bg-white px-4 py-3.5 shadow-card"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <CategoryIcon name={chip.icon} className="h-4 w-4" />
              </span>
              <span className="min-w-0 truncate text-sm font-semibold text-ink-800">{chip.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Why Tixit ── */}
      <section className="border-y border-ink-100 bg-ink-50/60">
        <div className="container-page py-14">
          <div className="mb-8 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">Why list with Tixit</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
              Everything selling a show needs, in one place
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-500">
              No stitching together a payment gateway, a spreadsheet and a guest list on a clipboard.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-xl border border-ink-100 bg-white p-5 shadow-card">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-4 text-sm font-bold text-ink-900">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="container-page py-14">
        <div className="mb-8 max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">How it works</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
            From enquiry to first ticket sold
          </h2>
        </div>

        <ol className="grid gap-4 lg:grid-cols-5">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
                {index + 1}
              </span>
              <h3 className="mt-4 text-sm font-bold text-ink-900">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Pricing + dashboard features ── */}
      <section className="container-page pb-14">
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="flex flex-col justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-8 text-center lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-200">Simple pricing</p>
            <p className="mt-4 text-5xl font-extrabold tracking-tight text-white">10%</p>
            <p className="mt-2 text-sm text-brand-100">of ticket revenue · negotiable at volume</p>
            <p className="mx-auto mt-5 max-w-xs text-sm leading-relaxed text-brand-100">
              No setup fee. No monthly charge. Free events are free to list — you only pay when you actually sell a
              ticket.
            </p>
            <div className="mt-7 flex justify-center">
              <ButtonLink
                href="/auth/register?role=organizer"
                size="lg"
                className="bg-white text-brand-700 hover:bg-brand-50"
              >
                Create your account
              </ButtonLink>
            </div>
          </div>

          <div className="rounded-2xl border border-ink-200 bg-white p-8 shadow-card lg:col-span-3">
            <h2 className="text-xl font-bold tracking-tight text-ink-900">What comes with every listing</h2>
            <p className="mt-1.5 text-sm text-ink-500">Included at no extra cost, on every plan, from day one.</p>

            <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {DASHBOARD_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-ink-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  {feature}
                </li>
              ))}
            </ul>

            <Link
              href="/organizer/register"
              className="mt-7 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              See the full organizer toolkit <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Enquiry ── */}
      <section id="enquiry" className="scroll-mt-20 border-y border-ink-100 bg-ink-50/60">
        <div className="container-page py-14">
          <div className="grid gap-8 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">Get in touch</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
                Tell us about your show
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-600">
                Send us the details and we&apos;ll come back within one business day with how to get your show listed,
                what it will cost, and anything we can help with on the day. Prefer to skip the conversation? Create an
                organizer account and start building right away.
              </p>

              <div className="mt-6 space-y-3 text-sm text-ink-600">
                <a href="mailto:support@tixit.in" className="flex items-center gap-2.5 hover:text-brand-600">
                  <Mail className="h-4 w-4 shrink-0 text-ink-400" aria-hidden /> support@tixit.in
                </a>
                <a href="tel:+917877701381" className="flex items-center gap-2.5 hover:text-brand-600">
                  <Phone className="h-4 w-4 shrink-0 text-ink-400" aria-hidden /> +91 78777 01381
                </a>
                <p className="flex items-center gap-2.5">
                  <MapPin className="h-4 w-4 shrink-0 text-ink-400" aria-hidden /> Jaipur, Rajasthan
                </p>
                <p className="flex items-center gap-2.5">
                  <CalendarDays className="h-4 w-4 shrink-0 text-ink-400" aria-hidden /> Mon–Sat, 10am – 7pm IST
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card sm:p-8 lg:col-span-3">
              <ListYourShowForm categories={categories ?? []} cities={cities ?? []} />
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="container-page py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">Questions organizers ask</h2>

          <div className="mt-6 space-y-2.5">
            {FAQS.map((faq) => (
              <details
                key={faq.question}
                className="group rounded-xl border border-ink-200 bg-white px-4 py-3.5 open:shadow-card"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink-900 marker:content-none">
                  {faq.question}
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-ink-400 transition-transform duration-200 group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <p className="mt-2.5 text-sm leading-relaxed text-ink-600">{faq.answer}</p>
              </details>
            ))}
          </div>

          <p className="mt-6 text-center text-sm text-ink-500">
            Something we haven&apos;t covered?{' '}
            <Link href="/support" className="font-semibold text-brand-600 hover:text-brand-700">
              Visit Help &amp; Support
            </Link>
          </p>
        </div>
      </section>

      {/* ── Closing CTA ── */}
      <section className="container-page pb-16">
        <div className="overflow-hidden rounded-2xl bg-ink-950 px-6 py-12 text-center sm:px-12">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Your next show could be selling tonight</h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-300 sm:text-base">
            Setting up takes minutes, and there is nothing to pay until a ticket sells.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/auth/register?role=organizer" size="lg">
              List your show
            </ButtonLink>
            <ButtonLink
              href="/events"
              size="lg"
              variant="outline"
              className="border-white/30 bg-transparent text-white hover:bg-white/10"
            >
              See what&apos;s already on
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
