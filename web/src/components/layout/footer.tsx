import Image from 'next/image';
import Link from 'next/link';
import { Facebook, Instagram, Mail, MapPin, Phone, Twitter } from 'lucide-react';

const COLUMNS = [
  {
    title: 'Discover',
    links: [
      { href: '/events', label: 'All Events' },
      { href: '/events?when=today', label: 'Happening Today' },
      { href: '/events?when=weekend', label: 'This Weekend' },
      { href: '/events?price=free', label: 'Free Events' },
      { href: '/events?sort=popular', label: 'Trending' },
    ],
  },
  {
    title: 'Categories',
    links: [
      { href: '/events?category=music', label: 'Music' },
      { href: '/events?category=comedy', label: 'Comedy' },
      { href: '/events?category=workshop', label: 'Workshops' },
      { href: '/events?category=sports', label: 'Sports' },
      { href: '/events?category=theatre', label: 'Theatre' },
    ],
  },
  {
    title: 'Organizers',
    links: [
      { href: '/list-your-show', label: 'List your show' },
      { href: '/organizer/register', label: 'List your event' },
      { href: '/organizer', label: 'Organizer dashboard' },
      { href: '/organizer/scan', label: 'Scan tickets' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/terms', label: 'Terms of Service' },
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/refunds', label: 'Refund Policy' },
      { href: '/support', label: 'Help & Support' },
    ],
  },
];

const CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Pune', 'Chennai', 'Kolkata', 'Goa'];

export function Footer() {
  return (
    <footer className="mt-20 border-t border-ink-800 bg-ink-950 text-ink-300">
      <div className="container-page py-14">
        <div className="grid gap-10 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center">
              <Image
                src="/brand/lockup-black.png"
                alt="Tixit — Find Your Moment"
                width={760}
                height={419}
                className="h-14 w-auto"
              />
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-400">
              Discover movies, events, concerts, comedy shows, sports and more — and book your seat in a single tap
              with an instant digital QR ticket.
            </p>

            <div className="mt-5 space-y-2 text-sm text-ink-400">
              <a href="mailto:support@tixit.in" className="flex items-center gap-2 transition hover:text-white">
                <Mail className="h-4 w-4 shrink-0" aria-hidden /> support@tixit.in
              </a>
              <a href="tel:+917877701381" className="flex items-center gap-2 transition hover:text-white">
                <Phone className="h-4 w-4 shrink-0" aria-hidden /> +91 78777 01381
              </a>
              <p className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0" aria-hidden /> Jaipur, Rajasthan
              </p>
            </div>

            <div className="mt-5 flex gap-2">
              {[
                { Icon: Instagram, label: 'Instagram', href: 'https://www.instagram.com/tixit.in/' },
                { Icon: Twitter, label: 'Twitter', href: null },
                { Icon: Facebook, label: 'Facebook', href: null },
              ].map(({ Icon, label, href }) =>
                href ? (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="grid h-9 w-9 place-items-center rounded-lg bg-ink-900 text-ink-400 transition hover:bg-ink-800 hover:text-white"
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                ) : (
                  <span
                    key={label}
                    aria-label={label}
                    className="grid h-9 w-9 place-items-center rounded-lg bg-ink-900 text-ink-400 transition hover:bg-ink-800 hover:text-white"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                ),
              )}
            </div>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-white">{column.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link href={link.href} className="text-sm text-ink-400 transition hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-ink-800 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Popular cities</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {CITIES.map((city) => (
              <Link
                key={city}
                href={`/events?city=${city.toLowerCase()}`}
                className="text-sm text-ink-400 transition hover:text-white"
              >
                Events in {city}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-ink-800 pt-6 sm:flex-row">
          <p className="text-xs text-ink-500">© {new Date().getFullYear()} Tixit. All rights reserved.</p>
          <p className="text-xs text-ink-500">Payments secured by Razorpay · UPI · Cards · Net Banking</p>
        </div>

        {/* Tixit is a SingleTap product — attribution sits below the legal line. */}
        <div className="mt-6 flex items-center justify-center gap-2.5">
          <span className="text-xs uppercase tracking-wide text-ink-500">Powered by</span>
          <Image
            src="/brand/singletap-white.png"
            alt="SingleTap"
            width={370}
            height={139}
            className="h-6 w-auto"
          />
        </div>
      </div>
    </footer>
  );
}
