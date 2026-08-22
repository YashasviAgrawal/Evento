import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronDown, FileText, Mail, MapPin, Phone, RotateCcw, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Help & Support',
  description:
    'Answers to common questions about booking, payments, refunds and QR tickets on Tixit, plus how to reach our support team.',
  alternates: { canonical: '/support' },
  openGraph: {
    title: 'Help & Support',
    description:
      'Answers to common questions about booking, payments, refunds and QR tickets on Tixit, plus how to reach our support team.',
    url: '/support',
  },
};

interface Faq {
  question: string;
  answer: string;
}

const FAQ_GROUPS: Array<{ title: string; items: Faq[] }> = [
  {
    title: 'Booking & tickets',
    items: [
      {
        question: 'How do I book a ticket?',
        answer:
          'Find an event, choose your ticket tier and quantity, and pay securely at checkout. Your confirmed booking generates a digital QR ticket instantly — no printing needed.',
      },
      {
        question: 'Where do I find my tickets?',
        answer:
          'Go to My Bookings from your account menu. Each booking shows its QR code, which you can also add to your phone’s calendar or share via the event page.',
      },
      {
        question: 'Can I transfer or share my QR ticket?',
        answer:
          'Each QR ticket is valid for a single scan at the venue. Screenshots or forwarded copies do not create additional valid entries, and the first successful scan is the one that counts.',
      },
      {
        question: 'What if an event is cancelled or rescheduled?',
        answer:
          'You’ll be notified by email, and cancelled events are automatically eligible for a full refund. See our Refund Policy for the exact timelines.',
      },
    ],
  },
  {
    title: 'Payments & refunds',
    items: [
      {
        question: 'What payment methods are accepted?',
        answer: 'UPI, credit/debit cards, and net banking, processed securely through Razorpay. Tixit never stores your full payment details.',
      },
      {
        question: 'How do I request a refund?',
        answer:
          'Open the booking under My Bookings and follow the refund prompt, or contact support with your booking code. Refund eligibility depends on how close to the event you are — see our Refund Policy for details.',
      },
      {
        question: 'How long do refunds take to process?',
        answer:
          'Once approved, refunds are typically credited back to your original payment method within 5–7 business days, depending on your bank.',
      },
    ],
  },
  {
    title: 'Account',
    items: [
      {
        question: 'I didn’t receive my OTP or confirmation email.',
        answer:
          'Check your spam folder first. If it still hasn’t arrived after a few minutes, request a new code from the login screen or reach out to support with the email/phone used to sign up.',
      },
      {
        question: 'How do I update my profile details?',
        answer: 'Go to Account → Profile to update your name, email, or phone number at any time.',
      },
    ],
  },
  {
    title: 'For organizers',
    items: [
      {
        question: 'How do I start selling tickets on Tixit?',
        answer:
          'Register as an organizer, and our team typically verifies your details within a day. Once verified, you can create events, set up ticket tiers, and submit them for review.',
      },
      {
        question: 'How and when do I get paid?',
        answer:
          'Revenue from ticket sales, minus the platform commission shown in your dashboard, is reconciled per booking and paid out to your registered account.',
      },
      {
        question: 'How does check-in work at the venue?',
        answer:
          'Use the Scan Tickets tool in your organizer dashboard on any phone. Each QR code is signed and single-use, so duplicate or forged tickets are declined automatically.',
      },
    ],
  },
];

const QUICK_LINKS = [
  { href: '/refunds', label: 'Refund Policy', icon: RotateCcw },
  { href: '/terms', label: 'Terms & Conditions', icon: FileText },
  { href: '/privacy', label: 'Privacy Policy', icon: ShieldCheck },
];

export default function SupportPage() {
  return (
    <>
      <section className="container-page py-14 lg:py-16">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">Help & Support</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
            How can we help?
          </h1>
          <p className="mt-4 text-base leading-relaxed text-ink-500">
            Answers to the questions we hear most about booking, payments, refunds and QR tickets. Can&apos;t find
            what you&apos;re after? Our support team is one message away.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2.5">
          {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-sm font-medium text-ink-700 transition hover:border-brand-200 hover:text-brand-700"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      </section>

      <section className="border-y border-ink-100 bg-ink-50/60">
        <div className="container-page py-12">
          <div className="mx-auto max-w-3xl space-y-10">
            {FAQ_GROUPS.map((group) => (
              <div key={group.title}>
                <h2 className="text-lg font-bold tracking-tight text-ink-900">{group.title}</h2>
                <div className="mt-4 space-y-2.5">
                  {group.items.map((faq) => (
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
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container-page py-14">
        <div className="mx-auto max-w-3xl rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-card md:p-12">
          <h2 className="text-2xl font-bold tracking-tight text-ink-900">Still need a hand?</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-500">
            Reach out with your booking code (if you have one) and we&apos;ll get back to you as soon as we can.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-ink-600">
            <a href="mailto:support@tixit.in" className="flex items-center gap-2 hover:text-brand-600">
              <Mail className="h-4 w-4 shrink-0 text-ink-400" aria-hidden /> support@tixit.in
            </a>
            <a href="tel:+917877701381" className="flex items-center gap-2 hover:text-brand-600">
              <Phone className="h-4 w-4 shrink-0 text-ink-400" aria-hidden /> +91 78777 01381
            </a>
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-ink-400" aria-hidden /> Jaipur, Rajasthan
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
