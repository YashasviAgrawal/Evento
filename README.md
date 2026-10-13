# Tixit — Event Ticket Booking Platform

A production-shaped event discovery and ticketing platform in the mould of District, BookMyShow and
MakeMyTrip Events. Customers discover events and book QR tickets in a single tap; organizers run
their events from a sales dashboard; admins moderate the marketplace and take a commission.

Built to the PRD in `docs/PRD.md`, on the stack it specifies.

---

## Contents

- [What's built](#whats-built)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [Content Studio (CMS)](#content-studio-cms)
- [Project layout](#project-layout)
- [How the hard parts work](#how-the-hard-parts-work)
- [Configuration](#configuration)
- [Testing](#testing)
- [Deployment](#deployment)
- [Further reading](#further-reading)

---

## What's built

### Customer
| Capability | Where |
| --- | --- |
| Signup / login with password **or** email OTP | `/auth/login`, `/auth/register` |
| Home: hero search, trending, categories, upcoming, popular cities, footer | `/` |
| Search by name, city, date, category; filter Today / Tomorrow / This Weekend / Free / Paid / price | `/events` |
| Event page: gallery, description, venue + Google Map, organizer, ticket tiers, T&Cs | `/events/[slug]` |
| Checkout: quantity → details → coupon → payment | `/checkout` |
| Online payment via UPI / card / net banking (Razorpay) | `/checkout` |
| QR ticket, PDF download, print view | `/account/bookings/[id]` |
| Booking history, cancellation, refund requests | `/account/bookings` |

### Organizer
| Capability | Where |
| --- | --- |
| Dashboard: revenue, tickets sold, sell-through, attendance, 30-day sales chart | `/organizer` |
| Create / edit / publish / pause / delete events | `/organizer/events` |
| Ticket tiers: Regular, VIP, Early Bird, Couple Pass, Group Pass — each with price, quantity, booking limit and sale window | `/organizer/events/[id]` |
| Banner upload (Cloudinary, local-disk fallback) | event editor |
| Bookings list with search, filters and **CSV export** | `/organizer/bookings` |
| **QR scanner** for door check-in, with manual-code fallback | `/organizer/scan` |
| Reports: sales, revenue, attendance, per-event breakdown | `/organizer/reports` |

### Admin
| Capability | Where |
| --- | --- |
| Platform overview: revenue, commission earned, users, growth | `/admin` |
| Approve / reject events, feature events, cancel events | `/admin/events` |
| Verify, suspend and set per-organizer commission | `/admin/organizers` |
| User management with instant session revocation | `/admin/users` |
| Coupons: percent / flat, caps, usage limits, expiry | `/admin/coupons` |
| Refund approval queue (approve → gateway refund) | `/admin/refunds` |
| Platform settings: commission, GST, fees, hold window, auto-approve | `/admin/settings` |
| Full audit trail | `/admin/audit-logs` (API) |

### Content Studio (CMS)

A standalone blog CMS on its own login, so publishing rights can be granted without handing
someone a platform admin account. See [Content Studio](#content-studio-cms).

| Capability | Where |
| --- | --- |
| Separate sign-in — own accounts, own tokens, no platform access | `/cms/login` |
| Dashboard: published/draft counts, views, activity feed | `/cms` |
| Articles: create, edit, publish, archive, delete, search, filter | `/cms/posts` |
| Markdown editor with slug, SEO, cover image and FAQ schema fields | `/cms/posts/[id]` |
| Categories: create, rename, reorder, delete | `/cms/categories` |
| Studio accounts: invite, set role, suspend, reset password, remove | `/cms/users` |
| Change your own password (revokes every session) | `/cms/account` |

Cross-cutting: transactional email (booking confirmed, payment receipt, cancellation, refund,
24-hour reminder, OTP, organizer verified, event approved/rejected), background jobs for hold
expiry and reminders, and an append-only audit log.

---

## Tech stack

Exactly as specified in the PRD:

| Layer | Choice |
| --- | --- |
| Frontend | **Next.js 15** (App Router) + **Tailwind CSS 3** + TypeScript |
| Backend | **Node.js 22** + **Express 4** + TypeScript |
| Database | **PostgreSQL 16** (raw SQL via `pg`, no ORM) |
| Storage | **Cloudinary** (falls back to local disk) |
| Payments | **Razorpay** (falls back to a signed local mock) |
| Email | **Resend** (falls back to console transport) |
| Auth | **JWT** access tokens + rotating refresh tokens + **email OTP** |

Every third-party integration degrades to a working local mode, so the whole product runs
end-to-end with **no external accounts or API keys**.

---

## Quick start

Requirements: Node ≥ 20.9 and a running PostgreSQL 16.

```bash
git clone <repo> && cd tixit
npm install

# 1. Configure
cp .env.example .env          # sane defaults work as-is for local dev

# 2. Create the database (adjust to your setup)
createdb evento
psql -d postgres -c "CREATE USER evento WITH PASSWORD 'evento' SUPERUSER;"

# 3. Schema + demo data
npm run migrate
npm run seed

# 4. Run both apps
npm run dev
```

- Web → <http://localhost:3000>
- API → <http://localhost:4000> (health at `/health`)

Useful scripts:

```bash
npm run dev            # API + web together
npm run build          # compile both for production
npm run test           # backend unit + integration suite
npm run typecheck      # strict TS across both workspaces
npm run db:reset       # drop, re-migrate, re-seed
npm run migrate:status # which migrations have run
```

---

## Demo accounts

Seeded by `npm run seed`. Password for all: **`Password123`**

| Role | Email | Notes |
| --- | --- | --- |
| Admin | `admin@tixit.test` | Full console |
| Organizer | `organizer@tixit.test` | Verified, 5 events |
| Organizer | `priya@tixit.test` | Verified |
| Organizer | `sana@tixit.test` | **Pending verification** — shows the gated state |
| Customer | `customer@tixit.test` | Has booking history |

Seed coupons: `WELCOME10` (10% off), `FLAT200` (₹200 off over ₹1,000), `TIXIT25` (25%, capped
at ₹500), `EXPIRED50` (expired, for testing the failure path).

Because Razorpay runs in mock mode without keys, **checkout completes for real** — the mock
signs the order with the same HMAC construction Razorpay uses, and the server verifies it through
the identical code path used in production.

---

## Content Studio (CMS)

The blog is managed from **`/cms`**, which is a separate application with a separate
authentication system. A Studio account is not a platform account: it lives in `cms_users`, its
sessions live in `cms_sessions`, and its access tokens are signed with `CMS_JWT_ACCESS_SECRET`
under a different issuer and audience.

That separation is the point. A platform admin token presented to a `/cms` endpoint fails
signature verification outright — it is not rejected by a role check that someone could later
loosen. It also means the reverse holds: a Studio account can publish articles and can do nothing
else on the platform. Granting a freelance writer publishing rights no longer means granting them
the ability to approve payouts.

Practical consequences:

- **No public sign-up.** Accounts are created by an existing Studio admin at `/cms/users`, or from
  the command line for the very first one.
- **Separate sessions.** Signing out of Tixit does not sign you out of the Studio, and the tokens
  are kept under different `localStorage` keys and sent in a different header.
- **Its own activity trail** (`cms_activity`), because `audit_logs.actor_id` is a foreign key into
  `users` and a Studio account is not one.
- **Two roles.** `editor` writes, publishes and deletes content; `admin` does that and manages
  Studio accounts.

### Setting it up

```bash
# 1. Apply the migration that creates the CMS tables
npm run migrate

# 2. Set CMS_JWT_ACCESS_SECRET in .env — different from JWT_ACCESS_SECRET
#    openssl rand -hex 48

# 3. Create the first Studio admin (prints a generated password once)
npm run cms:user -- --email you@example.com --name "Your Name"
```

Then sign in at `/cms/login` and add the rest of the team from **Accounts**.

Re-running `cms:user` for an address that already has an account resets that account's password
and revokes its open sessions — the way back in if the only admin is locked out.

The pre-existing blog editor at `/admin/blog` is untouched and still works for platform admins;
both write to the same `blog_posts` table, so an article created in either is visible in the other.

---

## Project layout

```
Tixit/
├── server/                        Express API
│   └── src/
│       ├── config/                env parsing, logger
│       ├── db/                    pool, migration runner, migrations/, seed
│       ├── middleware/            auth, RBAC, validation, errors, rate limits
│       ├── modules/
│       │   ├── auth/              JWT, refresh rotation, OTP
│       │   ├── events/            discovery, lifecycle, ticket types
│       │   ├── bookings/          pricing + the transactional booking engine
│       │   ├── payments/          Razorpay orders, verification, webhooks, refunds
│       │   ├── tickets/           QR signing, check-in, PDF
│       │   ├── coupons/           validation and redemption
│       │   ├── organizer/         dashboard, bookings, CSV, scanning
│       │   ├── admin/             moderation, users, coupons, refunds, settings
│       │   ├── blog/              articles and categories (shared by admin + CMS)
│       │   ├── cms/               Content Studio: own accounts, tokens, guards
│       │   └── reports/           analytics queries
│       ├── services/              mail, storage, settings, audit, Razorpay
│       ├── jobs/                  hold expiry, reminders, housekeeping
│       └── utils/                 money, ids, signing, csv, dates, http
└── web/                           Next.js client
    └── src/
        ├── app/                   routes (public, account, organizer, admin, cms)
        ├── components/            UI kit, layout, dashboard, event, auth, cms
        └── lib/                   API client, types, formatting, Razorpay loader
```

---

## How the hard parts work

### Ticket inventory can never oversell

The single most important invariant. Three layers:

1. **Row locks.** `createBooking` opens a transaction and does
   `SELECT … FROM ticket_types WHERE id = ANY(...) ORDER BY id FOR UPDATE`. Ordering by `id`
   means concurrent transactions always take locks in the same sequence, so they queue instead of
   deadlocking.
2. **Availability under the lock.** `available = quantity_total − quantity_sold − quantity_held`
   is evaluated *after* the lock is held, so the number it reads is authoritative.
3. **A database CHECK constraint.** `CHECK (quantity_sold + quantity_held <= quantity_total)`.
   Even if the application logic regressed, the transaction would abort rather than oversell.

Verified by an integration test that fires eight concurrent single-ticket bookings at a five-seat
tier: exactly five succeed, three are rejected, and `sold + held` lands precisely on capacity.

### Money is never a float

Every amount is an **integer number of paise** in a `BIGINT` column, end to end — database,
API, Razorpay, reports. Rupees exist only at the moment of display. `calculatePricing` is the
single source of truth for order maths and is called by both the quote endpoint and the booking
transaction, so the total a customer is shown cannot drift from the total they are charged.

Commission and tax rates are **frozen onto each booking row** at creation. Changing the platform
commission tomorrow does not rewrite yesterday's revenue reports.

### Payments are idempotent

- The checkout callback is only trusted after its `HMAC(order_id|payment_id)` signature verifies.
- `confirmBooking` is a guarded UPDATE (`WHERE status = 'pending'`), so a webhook and a
  client-side verify racing each other cannot both decrement inventory or issue two sets of tickets.
- Webhook deliveries are deduplicated by a `UNIQUE (provider, provider_event_id)` ledger, which
  matters because Razorpay retries aggressively.
- The webhook is also the safety net for a customer whose browser dies after paying.

### QR tickets can't be forged or reused

Each ticket's QR encodes `TKT-XXXXXXXX.<hmac>`, where the HMAC is over **code + event id**. A
scanner rejects a fabricated code before touching the database, and a genuine ticket for one event
cannot be replayed at another. Admission is a conditional
`UPDATE … WHERE status = 'valid'` — because the check and the state change are the same statement,
two staff scanning simultaneously cannot both be told "admitted".

### Abandoned checkouts return their seats

A pending booking holds inventory for `booking_hold_minutes` (default 15). A background job
releases lapsed holds every minute, and the booking endpoint also sweeps opportunistically, so
seats abandoned moments ago are immediately bookable again.

### Security posture

- Passwords and OTPs are bcrypt-hashed; refresh tokens are stored only as SHA-256 digests.
- Refresh tokens rotate on use, so a stolen token works at most once and surfaces the compromise.
- Every request re-reads the user, so suspending an account revokes access immediately rather
  than at token expiry.
- Login timing is equalised so the endpoint is not an account-enumeration oracle.
- Rate limits are keyed by email (not just IP) on credential endpoints.
- All SQL is parameterised; the query builder never concatenates user input.
- CSV exports neutralise formula injection (`=`, `+`, `-`, `@`).
- Uploads are validated by magic number, not by the client-supplied MIME type.

---

## Configuration

`.env.example` documents every variable. Nothing below is required for local development.

| Variable | Effect when unset |
| --- | --- |
| `RAZORPAY_KEY_ID` / `_SECRET` | Payments run in signed mock mode |
| `RAZORPAY_WEBHOOK_SECRET` | Webhooks are acknowledged and ignored |
| `RESEND_API_KEY` | Emails are logged to the console and recorded in `notifications` |
| `CLOUDINARY_*` | Uploads are written to `server/uploads/` and served by the API |
| `JWT_*_SECRET`, `QR_SECRET`, `CMS_JWT_ACCESS_SECRET` | Development defaults are used — **the app refuses to boot in production without them** |

Set `CMS_JWT_ACCESS_SECRET` to a different value from `JWT_ACCESS_SECRET`. The issuer/audience
check would still reject a cross-posted token if they matched, but two independent secrets mean a
leak of one key never becomes a session in the other system.

Business rules (commission, GST, convenience fee, hold window, refund window, auto-approve) live
in the `settings` table and are editable from the admin console at runtime; the env values only
supply the initial defaults.

---

## Testing

```bash
npm run test        # 41 tests
```

- **Unit** — pricing maths, rounding, money conversion, QR signing, CSV escaping, ID generation.
- **Integration** — run against real PostgreSQL: booking holds, per-order and per-customer limits,
  concurrent oversell protection, confirmation idempotency, QR single-use check-in, cross-organizer
  scan rejection, hold expiry, cancellation and refund creation, and the database CHECK constraints.

The integration suite creates namespaced fixtures and cleans up after itself, so it is safe to run
against a seeded development database.

---

## Deployment

```bash
npm run build       # server → server/dist, web → web/.next
npm run migrate     # apply pending migrations
npm run start
```

Notes for a real deployment:

- Set every secret in `.env`; the API refuses to start in production with default JWT/QR secrets.
- Point `RAZORPAY_WEBHOOK_SECRET` at your Razorpay dashboard webhook and register
  `POST /api/v1/payments/webhook`.
- Background jobs run in-process. Behind more than one API instance, move them to a single worker
  or wrap them in an advisory lock so reminders are not sent twice.
- Rate limiting is in-memory; swap in the Redis store for a multi-instance deployment.

---

## Further reading

- [`docs/API.md`](docs/API.md) — full REST reference
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — data model, request lifecycle, design decisions
- [`docs/PRD.md`](docs/PRD.md) — the source requirements

## Future features

Called out in the PRD, deliberately not built: mobile app, referral programme, wallet, seat
selection, live streaming, AI recommendations, multi-language. The schema leaves room for each —
for example `tickets.seat_label` is already present for seat selection, and `notifications` is
channel-agnostic for push.
