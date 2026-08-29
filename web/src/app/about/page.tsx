import type { Metadata } from 'next';
import Image from 'next/image';
import { Mail, MapPin, Phone, Instagram, TicketCheck, ShieldCheck, Rocket, Users } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'About Us',
  description:
    'Tixit is a modern ticketing and experiences platform, built to make discovering and booking movies, events, concerts, comedy shows and sports effortless.',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About Tixit',
    description:
      'Tixit is a modern ticketing and experiences platform, built to make discovering and booking movies, events, concerts, comedy shows and sports effortless.',
    url: '/about',
  },
};

const VALUES = [
  {
    icon: TicketCheck,
    title: 'Effortless booking',
    description: 'Browse, book, and get an instant digital QR ticket in a single tap — no queues, no paperwork.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure by default',
    description: 'Payments are processed through trusted partners, and every ticket is scanned once to prevent duplicate entries.',
  },
  {
    icon: Rocket,
    title: 'Built for organizers',
    description: 'Organizers get real-time sales tracking, payouts, and a scanner app to run entry smoothly on event day.',
  },
  {
    icon: Users,
    title: 'For every kind of event',
    description: 'From music and comedy to workshops, sports and theatre — Tixit brings every experience onto one platform.',
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="container-page py-14 lg:py-16">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">About Tixit</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
            Find your moment, one ticket at a time
          </h1>
          <p className="mt-4 text-base leading-relaxed text-ink-500">
            Tixit is a ticketing and experiences platform that connects people with the movies, concerts, comedy
            shows, workshops, and sporting events happening around them. We handle discovery, secure payments, and
            instant digital QR tickets, so organizers can focus on putting on a great show and attendees can focus on
            showing up.
          </p>
        </div>
      </section>

      <section className="border-y border-ink-100 bg-ink-50/60">
        <div className="container-page grid gap-10 py-12 md:grid-cols-2 md:gap-16">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink-900">Our story</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-600">
              Tixit started with a simple frustration: booking a ticket shouldn&apos;t be harder than the event
              itself. Between scattered listings, clunky checkouts, and paper tickets that are easy to lose, both
              attendees and organizers deserved something simpler. So we built one platform that handles both sides —
              a place where people can find what&apos;s on nearby, and organizers can list, sell, and manage entry
              without stitching together five different tools.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink-900">What we believe</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-600">
              Great experiences bring people together, and getting a ticket should never be the hard part. We
              prioritize a fast, trustworthy booking flow for customers and transparent, real-time tools for
              organizers — because both sides of the platform have to work well for either to work at all.
            </p>
          </div>
        </div>
      </section>

      <section className="container-page py-14">
        <div className="mb-8">
          <h2 className="text-2xl font-bold tracking-tight text-ink-900">Why Tixit</h2>
          <p className="mt-1 text-sm text-ink-500">The essentials, done right</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-xl border border-ink-100 bg-white p-5 shadow-card">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-sm font-bold text-ink-900">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container-page pb-14">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-ink-100 bg-ink-50/60 px-8 py-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Powered by</p>
          <Image
            src="/brand/singletap-dark.png"
            alt="SingleTap"
            width={370}
            height={139}
            className="h-9 w-auto"
          />
          <p className="max-w-md text-sm leading-relaxed text-ink-500">
            Tixit is powered by SingleTap.
          </p>
        </div>
      </section>

      <section className="container-page pb-16">
        <div className="grid gap-10 rounded-2xl border border-ink-100 bg-white p-8 shadow-card md:grid-cols-2 md:p-12">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink-900">Get in touch</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              Questions, feedback, or want to talk about listing your event? We&apos;d love to hear from you.
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
              <a
                href="https://www.instagram.com/tixit.in/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 hover:text-brand-600"
              >
                <Instagram className="h-4 w-4 shrink-0 text-ink-400" aria-hidden /> @tixit.in
              </a>
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 p-8 text-center">
            <h3 className="text-xl font-bold text-white">Running an event?</h3>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-brand-100">
              List it on Tixit and start selling tickets in minutes.
            </p>
            <div className="mt-6 flex justify-center">
              <ButtonLink href="/organizer/register" size="lg" className="bg-white text-brand-700 hover:bg-brand-50">
                Start selling tickets
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
