'use client';

import Link from 'next/link';
import { BarChart3, CheckCircle2, CreditCard, QrCode, Ticket, Users } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/index';

const BENEFITS = [
  {
    icon: Ticket,
    title: 'Flexible ticket tiers',
    description: 'Early bird, VIP, couple and group passes — each with its own price, quantity and booking limit.',
  },
  {
    icon: CreditCard,
    title: 'Payments handled for you',
    description: 'UPI, cards and net banking through Razorpay. Money is reconciled per booking, automatically.',
  },
  {
    icon: QrCode,
    title: 'QR check-in at the door',
    description: 'Every ticket carries a signed, single-use QR code. Scan with any phone — no extra hardware.',
  },
  {
    icon: BarChart3,
    title: 'Live sales dashboard',
    description: 'Track revenue, sell-through and attendance in real time, and export everything as CSV.',
  },
];

const STEPS = [
  'Create your organizer account',
  'Our team verifies your details (usually within a day)',
  'Build your event and set up ticket tiers',
  'Submit for review — then start selling',
];

export default function OrganizerRegisterPage() {
  const { user } = useAuth();
  const isOrganizer = user?.role === 'organizer';

  return (
    <div>
      {/* Hero */}
      <section className="bg-ink-950 py-16">
        <div className="container-page text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white">
            <Users className="h-3.5 w-3.5" aria-hidden />
            For event organizers
          </span>

          <h1 className="mx-auto mt-6 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            Sell tickets to your event, <span className="text-brand-500">without the hassle</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-300">
            Set up an event in minutes, take payments securely, and scan attendees in at the door — all from one
            dashboard.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {isOrganizer ? (
              <ButtonLink href="/organizer" size="lg">
                Go to your dashboard
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href="/auth/register?role=organizer" size="lg">
                  Create an organizer account
                </ButtonLink>
                <ButtonLink
                  href="/auth/login"
                  size="lg"
                  variant="outline"
                  className="border-white/30 bg-transparent text-white hover:bg-white/10"
                >
                  Sign in
                </ButtonLink>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="container-page py-14">
        {user && user.role === 'customer' && (
          <Alert tone="info" className="mb-10" title="You’re signed in as a customer">
            Organizer access needs a separate account.{' '}
            <Link href="/auth/register?role=organizer" className="font-semibold underline">
              Register as an organizer
            </Link>
          </Alert>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          {BENEFITS.map((benefit) => (
            <div key={benefit.title} className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <benefit.icon className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-base font-bold text-ink-900">{benefit.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{benefit.description}</p>
            </div>
          ))}
        </div>

        <section className="mt-14">
          <h2 className="text-center text-2xl font-bold tracking-tight text-ink-900">How it works</h2>

          <ol className="mx-auto mt-8 max-w-2xl space-y-4">
            {STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-4 rounded-xl border border-ink-200 bg-white p-4 shadow-card">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  {index + 1}
                </span>
                <span className="pt-1 text-sm font-medium text-ink-800">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14 rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-card">
          <h2 className="text-xl font-bold text-ink-900">Simple, transparent pricing</h2>
          <p className="mt-2 text-sm text-ink-600">
            A flat platform commission on ticket revenue. No setup fee, no monthly charge.
          </p>
          <p className="mt-5 text-4xl font-extrabold text-brand-600">10%</p>
          <p className="mt-1 text-xs text-ink-500">per ticket sold · negotiable at volume</p>

          <ul className="mx-auto mt-6 grid max-w-md gap-2 text-left">
            {['Unlimited events', 'Unlimited ticket tiers', 'QR check-in app', 'CSV exports & reports'].map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-ink-700">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                {item}
              </li>
            ))}
          </ul>

          {!isOrganizer && (
            <ButtonLink href="/auth/register?role=organizer" size="lg" className="mt-7">
              Get started free
            </ButtonLink>
          )}
        </section>
      </div>
    </div>
  );
}
