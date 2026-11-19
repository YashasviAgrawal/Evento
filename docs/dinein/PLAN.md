# Tixit Dine-in — Product & Engineering Plan

> **dinein.tixit.in** · Table reservations + in-app bill payment, under the Tixit brand, on the
> same account, API and database as **www.tixit.in**.

Status: proposal · Owner: Tixit core · Last updated: 19 Nov 2026

---

## 0. The decisions this plan makes

| # | Decision | Why |
| --- | --- | --- |
| D1 | **Pay Bill is the product; booking is the funnel.** The first thing built end-to-end is: enter bill → offers stack → pay → staff verify → ledger → settlement. | Commission on the paid bill is the only revenue line that works on day one. A booking-only app has no revenue and no reason for diners to come back. |
| D2 | **One API, one database, one account.** Dine-in becomes new bounded contexts inside the existing Express API (a *modular monolith*), in its own Postgres schema `dining`. It is **not** a second backend. | One identity, one payments integration, one audit log, one deploy pipeline. Each context sits behind its own module boundary, so any one of them can be pulled out into a service later without a rewrite. |
| D3 | **A new Next.js app `dinein/`** deployed to `dinein.tixit.in`, built from **shared packages** (`@tixit/ui`, `@tixit/auth`, `@tixit/api-client`, `@tixit/config`) that are extracted from `web/`. Code is never copied between apps. | Same brand from the same source. When a button changes, it changes everywhere. |
| D4 | **SSO through the API host.** The session lives in an `HttpOnly` refresh cookie on `api.tixit.in`. Each app holds its access token **in memory only** and gets it by calling `/auth/refresh` on boot. Signing in on either app signs you in on both. | Every `*.tixit.in` origin is *same-site* with `api.tixit.in`, so the cookie is sent from both apps. No tokens in `localStorage`, so XSS can't steal a session. |
| D5 | **Partner access is a membership, not a role.** `users.role` stays `admin / organizer / customer`. Restaurant staff access comes from `dining.restaurant_members` (owner / manager / host / cashier). | One person can be a diner, an event organizer and a restaurant owner at the same time. Adding a fourth enum value would turn into a permissions rewrite later. |
| D6 | **A platform-wide double-entry ledger** (`finance` schema) for every rupee that dine-in moves. Event payouts can move onto it later. | Bill payments split money four ways: restaurant, platform, bank, tax. A single-column "payout" model can't be reconciled. |
| D7 | **Don't become a Payment Aggregator.** Use **Razorpay Route** (split settlement) through the existing `razorpay.provider.ts`, which keeps its mock fallback. | RBI PA licensing needs ₹15 Cr net worth plus escrow. Razorpay already holds the licence and the escrow. |
| D8 | **Postgres-backed job queue (pg-boss)** replaces `setInterval` jobs, for both products. | Dine-in adds time-critical jobs: slot materialisation, reminders, cashback release, settlement runs. With in-process timers these double-fire once there is more than one instance. pg-boss runs on Postgres, so no Redis is needed on Hostinger. |
| D9 | **Service charge is a separate, opt-out, non-discountable line** in the bill model. | Required by the Delhi HC / CCPA position, and a trust differentiator. |

---

## 1. Scope by phase

The roadmap from the research brief, cut to what this codebase ships in each phase. Each phase ends
with a deployable product, not a half-built one.

| Phase | Ships | Explicitly *not* yet |
| --- | --- | --- |
| **P0 — Foundations** (2–3 wks) | SSO (§3), shared packages (§2.3), pg-boss, `finance` ledger core, membership-based partner access, `dinein` app shell on the subdomain with the shared login | Any dining features |
| **P1 — Pay Bill MVP** (5–6 wks) | Restaurant catalog + discovery, restaurant page, walk-in **Pay Bill** with restaurant offers + platform coupon, live verification pass, partner console (payments feed, offers, payouts), admin onboarding/KYC/commission, weekly settlement, receipts | Booking, cashback, bank offers |
| **P2 — Reservations** (4–5 wks) | Slot inventory, free bookings, auto/manual accept, reminders, no-show tracking, "Pay Bill" from a booking, verified reviews | Cover-charge bookings |
| **P3 — Retention** (4–6 wks) | Tixit Wallet cashback (cooling-off + clawback), cover-charge bookings with 24 h refund rule, bank offers (BIN), split bill, collections/editorial | Membership, festivals |
| **P4 — Scale** | Petpooja POS integration (auto-fill bill), Tixit Pass membership (shared events + dining perks), festival builder, ads/promoted listings, T+1 payouts, multi-city | — |

Launch market: **one city, 2–3 neighbourhood clusters, 100–200 outlets.** Jaipur is suggested,
since the seed data and the business are already based there.

---

## 2. System architecture

### 2.1 Hosts

```
                 ┌──────────────────────┐      ┌──────────────────────┐
                 │  www.tixit.in        │      │  dinein.tixit.in     │
                 │  Next.js  (web/)     │      │  Next.js  (dinein/)  │
                 └──────────┬───────────┘      └──────────┬───────────┘
                            │  fetch(credentials:'include')│
                            └──────────────┬───────────────┘
                                           ▼
                             ┌──────────────────────────┐
                             │  api.tixit.in            │   ← owns the session cookie
                             │  Express  (server/)      │
                             │  ├─ identity  (auth)     │
                             │  ├─ events / bookings    │
                             │  ├─ dining/*   ◄── new   │
                             │  ├─ finance/*  ◄── new   │
                             │  └─ jobs (pg-boss)       │
                             └────────────┬─────────────┘
                                          ▼
                     PostgreSQL 16 — schemas: public · dining · finance
```

`api.tixit.in` must be on the `tixit.in` registrable domain. This is the one hard infrastructure
requirement for SSO. If the API is currently served from some other host, move it during P0.

### 2.2 Backend layout (modular monolith)

```
server/src/modules/
├── auth/                   (existing) + session-family rotation, cookie SSO
├── identity/               NEW  memberships, consent records (DPDP)
├── dining/
│   ├── catalog/            restaurants, outlets, media, amenities, cuisines
│   ├── discovery/          geo + text search, collections, ranking
│   ├── availability/       inventory rules → materialised slots, holds
│   ├── reservations/       booking state machine
│   ├── offers/             offer CRUD + the pure stacking engine
│   ├── billpay/            bill quote, payment, verification pass
│   ├── reviews/            payment-verified reviews
│   ├── partner/            partner-console endpoints (scoped by membership)
│   └── admin/              onboarding, KYC, commission plans, approvals
├── finance/
│   ├── ledger/             double-entry posting, balances
│   ├── settlement/         payout runs, statements, Razorpay Route transfers
│   └── wallet/             Tixit Wallet (cashback), shared by both products
└── jobs/                   pg-boss queues + handlers, one file per job
```

Module rules. These are enforced in review and with an ESLint `no-restricted-imports` rule:

1. A module exposes `*.routes.ts` (HTTP) and `index.ts` (its public service API). Other modules
   import **only** from `index.ts`, never from another module's internals or tables.
2. Cross-context side effects go through a **transactional outbox** (`outbox_events` table,
   written in the same transaction, then dispatched by pg-boss). Examples: `BillPaid` → ledger,
   wallet, notifications, review prompt. This is what keeps the modules separable.
3. Every money-moving function takes a `PoolClient`, so callers can compose it into one transaction.
4. The existing conventions stay: raw SQL, integer **paise** in `BIGINT`, Postgres enums, trigger-
   maintained `updated_at`, forward-only checksummed migrations.

### 2.3 Frontend layout and shared packages

```
packages/
├── config/        tailwind preset (brand tokens), tsconfig base, eslint config
├── ui/            Button, Input, Badge, Card, Sheet, Dialog, Toast, Skeleton, Ticket/Receipt,
│                  DashboardShell, Charts, AppSwitcher, Avatar, EmptyState, ErrorState
├── auth/          AuthProvider, useAuth, RequireAuth, LoginForm, OtpForm, GoogleButton,
│                  safeNext(), cross-app session sync
├── api-client/    request(), ApiError, in-memory token store, silent refresh, fetchPublic
└── types/         API DTOs shared by both apps (generated from server zod schemas — §11)

web/       www.tixit.in    — imports @tixit/*; its own copies are deleted, not left beside
dinein/    dinein.tixit.in — imports @tixit/*
server/    api.tixit.in
```

**Hostinger and workspaces.** The `make updation for hostinger` commit removed the root
`workspaces` field. P0 restores it with `packages/*`, `server`, `web` and `dinein`, and both Next apps
set `transpilePackages: ['@tixit/*']` and `outputFileTracingRoot` to the **repo root**, so the
`standalone` output bundles the shared packages. **The first task of P0 is a deploy spike** that
confirms Hostinger builds a workspace app from the repo root. If it can't, the fallback is to publish
`@tixit/*` to GitHub Packages and depend on versions. We won't copy files between apps.

> Also found in P0: commit `5570542` changed `server` `build` from `tsc && copy-assets` to `tsc`.
> `node dist/db/migrate.js` would now find no `.sql` files and report "up to date". This is harmless
> while migrations run via `tsx`, but P0 puts the copy step back.

---

## 3. Single sign-on across www and dinein

### 3.1 How it works

```
 dinein.tixit.in (first visit, user already signed in on www)
   │
   │ 1. boot: POST https://api.tixit.in/api/v1/auth/refresh   credentials:'include'
   │          (browser attaches the HttpOnly `tx_rt` cookie it holds for api.tixit.in)
   ▼
 api.tixit.in
   │ 2. finds valid refresh token → rotates it → Set-Cookie: tx_rt=<new>
   │ 3. returns { accessToken (15 min JWT), user }
   ▼
 dinein keeps accessToken IN MEMORY → user is signed in. No login screen.
```

Both apps use the same flow, so whichever app the user signs in on, the other one picks the
session up on its next boot or tab focus.

### 3.2 Cookies

| Cookie | Set by | Attributes | Purpose |
| --- | --- | --- | --- |
| `tx_rt` | api.tixit.in | `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; host-only` | Opaque refresh token (SHA-256 stored server-side, as today). Host-only on the API: neither frontend can read it, and neither needs to. |
| `tx_session` | api.tixit.in | `Secure; SameSite=Lax; Domain=.tixit.in; Path=/` · **not** HttpOnly · value `1` + expiry | A non-secret *hint* that a session exists. Next.js server components on either app read it to render the signed-in shell (avatar skeleton) with no flash, and the client skips the refresh call when it's absent. It grants nothing. |

Why this split: a `Domain=.tixit.in` cookie that carries the actual credential would be sent to every
subdomain, including any future marketing or blog host. Keeping the credential host-only on the API
limits who sees it. The hint cookie is the only one shared across the domain.

Local development: `localhost:3000` (web), `localhost:3001` (dinein) and `localhost:4000` (api) are
the same *site*, because ports don't change the site. Browsers treat `localhost` as a secure context,
so the same flow works in dev with no special case. `COOKIE_DOMAIN` is empty in dev (host-only).

### 3.3 Changes to the existing auth

| Today | Change | Reason |
| --- | --- | --- |
| Access + refresh tokens in `localStorage` (`evento.*`) | Access token in memory; refresh only in the cookie. `@tixit/api-client` reads any legacy `localStorage` values once, exchanges them, and deletes them. | `localStorage` is per-origin, so it can't do SSO, and XSS can read it. |
| Refresh cookie `SameSite=strict` (prod) | `SameSite=Lax` | Keeps the session when a user follows a link from email or WhatsApp into the app. Same-site fetches from both apps work either way. |
| Rotation: any reuse of an old token → `REFRESH_REVOKED` | **Session families with a reuse grace window.** Add `family_id`, `replaced_by_id` and `rotated_at` to `refresh_tokens`. If a just-rotated token comes back within **30 s**, return the successor that was already issued (idempotent). If it comes back later, it is a replay: revoke the **whole family**. | Two tabs or two apps waking at once would otherwise log each other out. That race is the most common SSO bug. |
| Refresh body accepts `refreshToken` | Kept for **native/mobile clients only** (`X-Client: mobile`). Browsers must use the cookie. | Removes token handling from browser JS. |
| — | CSRF on cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`): require an `Origin` in `CORS_ORIGINS` **and** an `X-Tixit-Client` header. | Lax cookies plus a custom header that a cross-site form can't send. |
| — | `GET /auth/session` returns `{ user, sessionId }` | Lets an app confirm the current account cheaply after a tab regains focus. |

### 3.4 Signing out everywhere

- `POST /auth/logout` revokes the family and clears `tx_rt` and `tx_session`.
- **Same app, other tabs**: `BroadcastChannel('tixit-auth')` posts `signed-out`.
- **The other app**: `BroadcastChannel` doesn't cross origins, so on `visibilitychange`/`focus` each
  app checks `document.cookie` for `tx_session`. If it's gone, the app drops its in-memory token and
  user. The next API call would return 401 anyway; this check just stops a stale avatar from showing.
- **Account switch**: if `/auth/session` returns a different `user.id` than the one in memory, the
  app resets all client state (query cache, cart, drafts) before rendering.

### 3.5 Shared login, signup and Google

- The login and signup UI comes from `@tixit/auth` and is mounted at `/auth/*` in **both** apps. The
  user stays on the subdomain they started on, and the existing `?next=` handling via `safeNext()`
  carries over unchanged.
- Signing up from dine-in creates the same `users` row. `signup_source` (`web | dinein | mobile`) is
  recorded for attribution only.
- Google: add `https://dinein.tixit.in` (and `http://localhost:3001`) to the OAuth client's
  **Authorised JavaScript origins**. The ID-token verification on the server doesn't change.
- **Phone OTP** is the main sign-in for diners at the table. Add a `phone` OTP channel (MSG91 or
  Gupshup, DLT-registered template) behind the same `otp.service`, with a console fallback in dev as
  for email today. Email and Google stay available.

### 3.6 Acceptance tests (Playwright, run in CI)

1. Sign in on `web` → open `dinein` → signed in, no login screen, nothing flashes.
2. Sign in on `dinein` via phone OTP → open `web` → signed in.
3. Two tabs plus both apps refresh at the same instant → nobody is signed out.
4. Replay an old refresh token after 60 s → the whole family is revoked → both apps signed out.
5. Sign out on `web` → focus a `dinein` tab → signed-out state within one focus event.
6. Suspend the user in admin → next API call on either app → 403 `ACCOUNT_SUSPENDED` (existing).

---

## 4. Roles and partner access

```sql
CREATE TYPE dining.member_role AS ENUM ('owner', 'manager', 'host', 'cashier');

CREATE TABLE dining.restaurant_members (
  restaurant_id UUID NOT NULL REFERENCES dining.restaurants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id)       ON DELETE CASCADE,
  role          dining.member_role NOT NULL,
  invited_by    UUID REFERENCES public.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, user_id)
);
```

| Capability | owner | manager | host | cashier |
| --- | :-: | :-: | :-: | :-: |
| See payments feed, verify a bill | ✓ | ✓ | ✓ | ✓ |
| Accept / decline / seat bookings | ✓ | ✓ | ✓ | — |
| Edit slots, offers, menu, photos | ✓ | ✓ | — | — |
| Payouts, statements, bank details | ✓ | — | — | — |
| Invite / remove staff | ✓ | ✓ (not owners) | — | — |

The middleware is `requireRestaurantMember(...roles)`. It resolves `:restaurantId` from the route,
loads membership in the same query as the user (extending `resolveUser`), and caches it per request.
Admins pass through for support, as `requireOrganizer` does today. Capabilities are defined in a
single map in code, so adding a role is a one-line change.

---

## 5. Data model (`dining` and `finance` schemas)

All money is `BIGINT` paise. Every table has `created_at` and `updated_at` with the existing trigger.
Only the important columns are listed here.

### 5.1 Catalog

| Table | Key columns / constraints |
| --- | --- |
| `dining.brands` | Chains. `name`, `slug`, `logo_url` |
| `dining.restaurants` | One row per **outlet**. `brand_id?`, `slug UNIQUE`, `name`, `city_id → cities`, `locality`, `address`, `lat`/`lng NUMERIC(9,6)`, `cost_for_two_paise`, `cuisines TEXT[]`, `tags TEXT[]` (rooftop, live-music, pure-veg, bar…), `hours JSONB` (per weekday, multi-shift), `status` enum (`draft, pending_review, live, paused, delisted`), `pay_bill_enabled`, `booking_enabled`, `auto_accept`, `gstin`, `fssai`, `commission_plan_id`, `rating_avg`, `rating_count`, `search_vector` (generated) |
| `dining.restaurant_media` | `kind` (`cover, ambience, food, menu`), `url`, `sort`, `source` (`partner, diner`), `moderation_status` |
| `dining.collections` + `collection_items` | Editorial lists ("Rooftops of C-Scheme") |

Geo: start with a btree index on `(city_id, lat, lng)`, a bounding-box prefilter and haversine in SQL.
No extension needed, and fast enough for one city. Discovery sits behind a `DiscoveryRepository`
interface, so moving to PostGIS or OpenSearch is a single adapter change.

### 5.2 Availability and reservations

| Table | Key columns / constraints |
| --- | --- |
| `dining.inventory_rules` | `restaurant_id`, `weekday`, `start_time`, `end_time`, `slot_minutes`, `covers_per_slot`, `max_party`, `valid_from/to` |
| `dining.blackouts` | `restaurant_id`, `starts_at`, `ends_at`, `reason` |
| `dining.slots` | Materialised 14 days ahead by a job. `restaurant_id`, `starts_at`, `capacity`, `held`, `booked`, `UNIQUE (restaurant_id, starts_at)`, **`CHECK (held + booked <= capacity)`** |
| `dining.reservations` | `code UNIQUE` (`DIN-XXXXXX`), `user_id`, `restaurant_id`, `slot_id`, `party_size`, `status` (`pending_payment, placed, confirmed, seated, completed, cancelled_by_diner, cancelled_by_restaurant, no_show, expired`), `offer_snapshot JSONB`, `cover_paise`, `occasion`, `notes`, `source`, `accepted_at`, `seated_at` |

The booking engine follows the pattern already proven in `booking.service.ts`: `SELECT … FOR UPDATE`
on the slot row, compute capacity under the lock, and let the CHECK constraint be the last line of
defence. A cover-charge booking holds the slot for `BOOKING_HOLD_MINUTES`, and the existing
hold-expiry sweep is generalised to cover it.

### 5.3 Offers

| Table | Key columns |
| --- | --- |
| `dining.offers` | `owner` (`restaurant, platform, bank, membership`), `restaurant_id?`, `kind` (`percent, flat, free_item`), `value`, `max_discount_paise?`, `min_bill_paise?`, `applies_to` (`prebook, walkin, both`), `base` (`food_only, food_and_bev`), `schedule JSONB` (weekday × time windows), `slot_ids?`, `valid_from/to`, `per_user_limit`, `budget_paise?`, `funding JSONB` (`{restaurant: 80, platform: 20}`, must sum to 100), `status`, `version` |
| `dining.offer_redemptions` | `offer_id`, `user_id`, `bill_payment_id`, `discount_paise`, `funding_breakdown JSONB` |

Offers are **versioned**: editing one creates a new version, and a bill stores the exact version it
used. This uses the same rule as the existing `booking_items` price snapshot.

### 5.4 Bill payments

```
dining.bill_payments
  id, code UNIQUE ('BIL-XXXXXX'), user_id, restaurant_id, reservation_id?
  status            bill_status  -- created → pending_payment → paid → verified | disputed
                                 --          → failed | cancelled ; paid → refunded
  -- what the diner entered
  bill_total_paise          BIGINT NOT NULL CHECK (> 0)
  non_discountable_paise    BIGINT NOT NULL DEFAULT 0   -- alcohol etc., if excluded
  service_charge_paise      BIGINT NOT NULL DEFAULT 0   -- separate, opt-out, never discounted
  tip_paise                 BIGINT NOT NULL DEFAULT 0
  -- engine output (immutable once paid)
  pricing JSONB NOT NULL        -- full line-by-line breakdown + engine version
  restaurant_discount_paise, platform_discount_paise, bank_discount_paise,
  wallet_used_paise, cover_credit_paise, convenience_fee_paise, amount_payable_paise
  commission_base_paise, commission_paise, commission_gst_paise
  -- verification
  verify_secret       TEXT   -- seeds the rotating code, never sent raw
  verified_by         UUID?  -- restaurant member
  verified_at, mismatch_reason
  pos_bill_ref        TEXT?  -- P4
  CHECK (non_discountable_paise <= bill_total_paise)
```

### 5.5 Finance (shared, double-entry)

```
finance.accounts         id, code UNIQUE, kind (asset|liability|revenue|expense),
                         owner_type (platform|restaurant|organizer|user|bank|tax), owner_id?
finance.transactions     id, kind (bill_paid, refund, settlement, cashback_credit, …),
                         source_type, source_id, idempotency_key UNIQUE, occurred_at
finance.entries          transaction_id, account_id, amount_paise BIGINT (signed: +debit / −credit)
                         -- constraint trigger (DEFERRABLE INITIALLY DEFERRED):
                         -- SUM(amount_paise) per transaction_id = 0
finance.settlements      restaurant_id, period_start, period_end, gross, deductions JSONB, net,
                         status, razorpay_transfer_id, utr
finance.wallet_entries   user_id, amount_paise, kind (cashback_pending, cashback_available,
                         redeemed, expired, clawback), available_at, expires_at, source
```

The entries are append-only. A correction is posted as a reversing transaction, and balances are
derived from the entries. A `BillPaid` posting for a ₹2,000 bill is worked through in §6.2.

### 5.6 Other tables

`dining.reviews` (`bill_payment_id UNIQUE`, so one review per paid visit is marked as verified),
`identity.consents` (DPDP: purpose, version, granted_at, withdrawn_at), `public.outbox_events`,
`public.payments` (see §7).

---

## 6. Core engines

### 6.1 Offer stacking: one pure function

`dining/offers/engine.ts` exports `priceBill(input, context) → BillPricing`. It has no I/O and no
clock (time is passed in), so it is fully deterministic and unit-testable. Like the existing
`pricing.ts`, the **quote endpoint and the payment transaction call the same function**, so a quote
can never disagree with the charge.

Order of application. Each step works on the remainder left by the step before:

```
1. discountable base     = bill_total − non_discountable − service_charge
2. restaurant offer      best eligible (prebook/walk-in, schedule, min bill, cap)
3. membership benefit    (P4)
4. platform coupon       one at most, per-user limits
5. cover-charge credit   (P3) — not a discount; reduces amount payable
6. bank offer            (P3) BIN-matched at payment step, capped
7. wallet                (P3) capped at X% of payable
8. + service charge (if diner keeps it) + tip + convenience fee (+18% GST on fee)
```

The engine returns **every line with its funder** (`restaurant | platform | bank`). The UI shows
exactly this breakdown, which is what the "transparent bill" differentiator rests on. When several
offers are eligible, it picks the combination with the lowest amount payable; ties go to the one
that costs the platform least. Property-based tests (fast-check) check the invariants: the payable
amount is never negative, the parts always add back up to the whole, and discounts never touch
non-discountable lines.

### 6.2 Worked ledger posting (₹2,000 bill, 20% restaurant offer, 8% commission)

| Account | Dr / Cr (₹) |
| --- | --- |
| Razorpay clearing (asset) | Dr 1,610.00 (1,600 + ₹10 fee) |
| Restaurant payable (liability) | Cr 1,600.00 |
| Restaurant payable | Dr 151.04 (commission 128 + 18% GST 23.04) |
| Commission revenue | Cr 128.00 |
| GST payable — output | Cr 23.04 + 1.80 |
| Convenience-fee revenue | Cr 8.20 (₹10 incl. GST) |
| …PG fee and TCS lines post when Razorpay's settlement file is reconciled | |

The settlement run then pays out the restaurant payable balance, less any TCS, through a Route
transfer. Statements are generated from the ledger, not from separate SQL.

### 6.3 Bill verification: stopping fake screenshots

1. **Live pass on the diner's phone.** It shows the restaurant name, amount, a server-synced clock
   with ticking seconds, and a **6-digit code that rotates every 30 s** (HMAC(`verify_secret`,
   time-step), the TOTP construction). A moving brand-gradient band and the ticking seconds make a
   static screenshot obviously stale.
2. **Partner feed.** The payment appears on the partner console in real time (SSE, with 5 s polling
   as a fallback). Staff compare the code and tap **Matches** or **Mismatch**. A mismatch opens a
   dispute: the diner either pays the difference through a top-up intent, or the payment is refunded.
3. **POS match (P4).** The bill is pre-filled from Petpooja, which closes the gap completely.

Bills not verified within 6 h are auto-verified unless disputed. This is a setting, and it stops
settlements stalling because staff forgot to tap. The risk rules from P1 are: per-user and
per-restaurant velocity, amount ceilings per restaurant (p99 × 3), and holding new restaurants'
first-week payouts.

### 6.4 Realtime without new infrastructure

The partner payment feed and booking inbox use **Server-Sent Events** from Express. Instances fan
out through Postgres `LISTEN/NOTIFY`, which the outbox dispatcher fires. No Redis or websocket
service is needed. **P0 verifies that Hostinger's proxy keeps SSE connections open.** If it doesn't,
the same endpoint drops to 5 s long-poll, and the client code doesn't change.

---

## 7. Payments

- `public.payments` gets **typed subject columns** instead of a polymorphic `subject_id`:
  `booking_id` becomes nullable, and `bill_payment_id` and `reservation_id` are added, with
  `CHECK (num_nonnulls(booking_id, bill_payment_id, reservation_id) = 1)`. Real foreign keys, one
  table, and the existing webhook ledger (`payment_events`) is reused unchanged.
- The `payment.service` verify/webhook path dispatches on the subject type to a `PaymentSubject`
  handler (`confirm`, `fail`, `refund`). Events bookings become the first implementer, so there is
  one code path for both products.
- **Razorpay Route** handles split settlement: each restaurant gets a linked account during
  onboarding, and settlement creates transfers. Mock mode signs transfers locally, matching the
  existing pattern.
- Idempotency: `POST /dining/bills/:id/pay` takes an `Idempotency-Key`, stored with a unique
  constraint, so a double-tap can't create two orders.

---

## 8. API surface (v1, all under `/api/v1`)

**Public / diner**
```
GET  /dining/home?city=jaipur&lat&lng          rails: offers near you, collections, trending
GET  /dining/restaurants?q&city&lat&lng&cuisine&cost&tags&offer&open_now&sort&page
GET  /dining/restaurants/:slug                 page payload (media, hours, offers, rating summary)
GET  /dining/restaurants/:slug/slots?date&party
POST /dining/reservations                      { slotId, partySize, occasion?, notes? }
GET  /dining/reservations · /:code · POST /:code/cancel · POST /:code/running-late
POST /dining/bills/quote                       { restaurantId, billTotal, nonDiscountable, keepServiceCharge, tip, couponCode?, reservationCode? }
POST /dining/bills                             same body → creates bill (status created)
POST /dining/bills/:code/pay                   → Razorpay order (Idempotency-Key)
GET  /dining/bills/:code/pass                  → { amount, restaurant, code, stepEndsAt, serverNow }
GET  /dining/bills · /:code/receipt.pdf
POST /dining/reviews                           { billCode, rating, text, photos[] }
GET  /wallet · /wallet/entries                 (P3, shared with events)
```

**Partner** (`requireRestaurantMember`)
```
GET  /partner/restaurants                       restaurants I belong to
GET  /partner/r/:id/feed (SSE)                  payments + bookings, live
POST /partner/r/:id/bills/:code/verify          { result: 'match' | 'mismatch', reason? }
GET|PATCH /partner/r/:id/reservations[/:code]   accept, decline, propose time, seat, no-show
CRUD /partner/r/:id/offers · /inventory-rules · /blackouts · /media · /members
GET  /partner/r/:id/analytics?range · /settlements · /settlements/:id/statement.pdf
```

**Admin**: `/admin/dining/restaurants` (onboarding queue, KYC, go-live), `/commission-plans`,
`/offers` (approval), `/settlements` (runs, holds), `/disputes`, `/collections`, `/risk`.

All request and response schemas are zod, as today. Types are generated into `@tixit/types` (§11).

---

## 9. Frontend apps

### 9.1 `dinein.tixit.in` routes

| Route | Screen |
| --- | --- |
| `/` | Home: location chip, search, "Tonight near you" rail, offer rails, collections, cuisines |
| `/restaurants` | Results: list ↔ map toggle, sticky filter bar, sort |
| `/r/[slug]` | Restaurant page: gallery, offers, slot strip, info, reviews, sticky **Book · Pay bill** dock |
| `/r/[slug]/book` | Booking sheet (route-backed, so Back closes it and the link can be shared) |
| `/pay/[slug]` · `/pay/qr/[token]` | Pay Bill: amount keypad → breakdown → pay |
| `/bills/[code]` | Live verification pass → receipt |
| `/reservations[/code]` | Upcoming / past, cancel, running late, directions |
| `/collections/[slug]` | Editorial list |
| `/wallet` (P3) · `/account` → links to the shared account on www | |
| `/auth/*` | `@tixit/auth` screens |
| `/partner/*` | Partner console: Live (feed), Reservations, Offers, Availability, Payouts, Insights, Staff, Settings |
| `/admin/*` | Dining ops (shared `DashboardShell`, with a product switcher to `www.tixit.in/admin`) |

Rendering: discovery and restaurant pages are **server components with ISR** (`revalidate: 60`)
for SEO, which is the long-tail acquisition channel ("rooftop restaurants in Jaipur"). Restaurant
pages carry `Restaurant` + `AggregateRating` + `Menu` JSON-LD. Everything personalised is a client
component using the shared API client. Data fetching on the client uses **TanStack Query**: one
cache, retries, focus refetch, and reset on account switch.

### 9.2 Cross-app touchpoints

- **App switcher pill** in both navbars: `Events | Dine-in`. This one control tells users it's one
  Tixit, one account.
- `www` home gets a "Dine-in near you" rail and an event page gets "Eat nearby before the show".
  This is the cross-sell between products.
- One `/account` (profile, security, consents) lives on www. Dine-in links to it, and SSO makes the
  hop seamless.

---

## 10. UI/UX design: "Tixit Dine-in"

A clickable high-fidelity concept of the main screens is at
[`docs/dinein/design-prototype.html`](./design-prototype.html). Open it in a browser.

### 10.1 Design principles

1. **One brand, an evening mood.** It keeps Tixit's rose `brand-600 #e11d48`, the slate `ink` scale,
   the system sans, the radii and the shadows. Dine-in leans into Tixit's existing **dark hero**
   (`ink-950` with rose glow) as its signature surface, because dining out is an evening activity.
   Content areas stay light for legibility.
2. **Money must be obvious.** Every price shows what you pay, what you save and who's paying for the
   saving. Savings are always **emerald** (Tixit already uses emerald for "free"). No dark patterns:
   fees are shown before the pay button, never after.
3. **One thumb, one hand.** Every main action sits in a bottom dock within thumb reach. Sheets are
   used instead of new pages for booking and filters.
4. **Calm motion.** Reuse the existing `ease-smooth`, `animate-enter` and press-scale. Motion only
   confirms or guides. `prefers-reduced-motion` is already respected globally.
5. **The receipt is the hero.** The bill breakdown reuses Tixit's **ticket perforation** component,
   so a dine-in receipt and an event ticket clearly come from the same family.

### 10.2 Tokens added to the shared preset

| Token | Value | Use |
| --- | --- | --- |
| `save` | emerald-600 `#059669`, bg emerald-50 | All savings and discounts |
| `night` surface | `ink-950` + `radial(rose-600/25)` + `violet-600/15` glow | Hero, verification pass, partner Live tab |
| `glass` | `white/8` + `backdrop-blur-xl` + `ring-white/10` | Chips and controls on dark surfaces |
| `radius-2xl/3xl` | 16 / 24 px | Sheets, image cards |
| `shadow-dock` | `0 -8px 24px -12px rgb(15 23 42 / .18)` | Bottom action dock |
| Type ramp | Display 32/36 `extrabold tracking-tight` · H2 20/28 `bold` · body 15/24 · caption 12/16 `semibold uppercase tracking-wide` | Matches the existing hero and card styles |
| Amount | `tabular-nums` on every number | Keypads and breakdowns don't jitter |

### 10.3 Key screens and interaction details

**Home.** A dark hero with a location chip ("C-Scheme, Jaipur ▾") and a big search ("Restaurants,
cuisines, dishes"). Below it, quick-intent chips: *Tonight · Pay bill · Rooftop · Date night · Pure
veg · Live music*. Then rails: **Tonight near you** (cards with a live slot strip, e.g. "7:30 · 30%
off"), **Best offers**, collections as large photo tiles, and cuisines as round tiles.

**Restaurant card.** A 4:3 image with a gradient scrim. The top-left offer badge is emerald on
white ("Flat 25% off"). The bottom row has name, rating pill, "₹1,400 for two · 1.2 km", and the next
three bookable slots as tappable chips that open the booking sheet pre-filled.

**Restaurant page.** A full-bleed gallery with page dots, then a sticky header that turns solid on
scroll. An **Offers band** shows pre-book vs walk-in side by side, with validity in plain words
("Mon–Thu, all day · Excludes alcohol"). The **slot strip** is a horizontal row of days, each slot
chip showing the offer depth, with the deepest ones highlighted. The **dock** holds **Book a table**
(primary rose) and **Pay bill** (dark), and is always visible.

**Booking sheet.** Three steps in one sheet: guests (a large stepper), date (a 7-day pill row), slot
(grid with offer per slot). The **confirm** button repeats the full choice ("Confirm · Sat 7:30 PM ·
4 guests · 30% off"). Success is a ticket-style confirmation card with add-to-calendar, directions
and share on WhatsApp.

**Pay bill.** A custom numeric keypad, so no OS keyboard covers the breakdown, and a huge
tabular-nums amount. One toggle: "Bill includes items not on offer (e.g. alcohol)?" reveals a second
amount field. Service charge is its own switch, **off by default**, with a one-line explainer. The
breakdown updates live as a receipt (perforated card): *Bill total → Restaurant offer (emerald, "paid
by restaurant") → Tixit coupon → You pay*. The pay button shows the exact amount.

**Verification pass.** A full-screen dark `night` surface. The restaurant logo, then the **amount in
display type**, a large rotating 6-digit code with a circular 30 s progress ring, a live clock with
seconds, and a slow brand-gradient sweep. "Show this to the staff." After the merchant taps
*Matches*, the pass flips with a gentle 3D rotate to a green **Verified** receipt, and the review
prompt is queued for 2 h later.

**Partner console: Live.** A desktop/tablet two-pane layout. The left side is an incoming stream of
payment cards (amount, last 4 digits of phone, code, time). Each card has two big buttons,
**Matches** (emerald) and **Mismatch**, with a soft chime and a pulse ring (existing `pulse-ring`
keyframe). The right side shows today's covers, bookings timeline and payout-due chip.

### 10.4 Accessibility and quality bar

WCAG 2.2 AA contrast on both surfaces. 44 px minimum touch targets. Visible focus rings (already
global). Every amount has an `aria-live="polite"` region. Skeletons that match the final layout (the
existing `.skeleton`). Empty and error states for every list. Lighthouse ≥ 90 on mobile for home and
restaurant pages, with LCP < 2.5 s on 4G (AVIF images via Cloudinary with `next/image` sizes, and
the hero is text-first).

---

## 11. Engineering guardrails (keeping technical debt out)

| Area | Rule |
| --- | --- |
| Types | Zod schemas in `server` are the source of truth. `npm run gen:types` emits `@tixit/types` (zod-to-ts). CI fails if the generated output is stale. |
| Boundaries | Import only module `index.ts`, enforced by ESLint. Cross-context effects go through the outbox. |
| Money | Paise `BIGINT` only, `money.ts` helpers, pure pricing engine, ledger sums enforced by the database. |
| Concurrency | Row locks + CHECK constraints for inventory. Idempotency keys on every POST that creates an order or payment. Guarded `UPDATE … WHERE status = …` for state transitions. |
| State machines | Reservation and bill statuses each have an explicit transition table in code, tested exhaustively. Illegal transitions throw `ConflictError`. |
| Jobs | Each job is idempotent and keyed (pg-boss `singletonKey`), with retries and backoff, and has a dead-letter alert. |
| Tests | Vitest unit tests (engine, ledger, state machines, rotating code), integration tests against real Postgres (existing pattern), Playwright E2E for SSO + Pay Bill + booking, and contract tests for Razorpay webhooks. |
| Observability | `pino` with request id (existing), plus `dining.*`/`finance.*` business events. `/health` reports pg-boss and SSE status. Sentry on both frontends. A nightly reconciliation job compares the ledger with the Razorpay settlement report and alerts on any drift. |
| Security | Rate limits on OTP, quote and pay. Admin and finance actions go to `audit_logs`. Partner endpoints are always scoped by membership, never by a client-supplied id alone. KYC documents use the existing private-file path. |
| Compliance | DPDP consent capture and withdrawal from P1 (core duties start 13 May 2027). Diner contact details shared with a restaurant are limited to name + masked phone, for that reservation only. Grievance officer page. GST invoice on commission. A tax opinion on TCS under §52 / TDS under §194-O is needed before P1 launch. |
| Config | Every new business rule (cooling-off hours, auto-verify window, slot horizon, cashback %) is a `settings` row editable in admin, not a code constant. |

---

## 12. Deployment on Hostinger

| Item | Value |
| --- | --- |
| DNS | `dinein` CNAME/A → the Hostinger Node app; `api` → the API app (if not already) |
| dinein app | Node 22, root = repo, build `npm ci && npm run build -w dinein`, start `node dinein/.next/standalone/dinein/server.js`, port from `$PORT` |
| API env additions | `CORS_ORIGINS=https://www.tixit.in,https://dinein.tixit.in` · `COOKIE_DOMAIN=.tixit.in` (hint cookie only) · `DINEIN_BASE_URL` · `SMS_PROVIDER`/keys · `RAZORPAY_ROUTE_ENABLED` |
| dinein env | `NEXT_PUBLIC_API_URL=https://api.tixit.in/api/v1` · `NEXT_PUBLIC_SITE_URL=https://dinein.tixit.in` · `NEXT_PUBLIC_WWW_URL=https://www.tixit.in` · `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (same client) · `NEXT_PUBLIC_MAPS_KEY` |
| Google OAuth | Add `https://dinein.tixit.in` to Authorised JavaScript origins |
| Jobs | pg-boss runs in the API process by default. Set `JOBS_ENABLED=false` on extra instances, or run a dedicated worker app when scaling out. |
| Migrations | Restore `copy-assets` in the server build. Run `npm run migrate` as a pre-start step. |

---

## 13. P0 and P1 task breakdown

**P0: Foundations**
1. Hostinger spike: workspace build from root + SSE keep-alive → go / no-go on the §2.3 fallback.
2. Restore workspaces. Create `packages/config` (Tailwind preset with existing tokens plus §10.2) and
   `packages/ui`, moving components out of `web/` with **no visual change** (screenshot-diff `web` before and after).
3. `packages/api-client` + `packages/auth`. Switch `web` to the in-memory token, with one-time migration from `localStorage`.
4. Server: session families + grace window, `tx_rt` / `tx_session` cookies, CSRF guard, `/auth/session`, phone OTP channel.
5. Migrations: `dining` + `finance` schemas, `restaurant_members`, `outbox_events`, ledger core with sum-zero trigger, `payments` subject columns.
6. pg-boss: move the existing jobs (hold expiry, reminders, OTP purge) onto it.
7. `dinein/` app shell: layout, navbar with app switcher, shared `/auth/*`, home placeholder. Deploy to the subdomain.
8. Playwright SSO suite (§3.6) green in CI.

**P1: Pay Bill MVP**
1. Catalog + admin onboarding (KYC reuses the `kyc-documents` service), commission plans, go-live checklist.
2. Discovery API + home / results / restaurant page (ISR, JSON-LD).
3. Offer CRUD (partner) + approval (admin) + the stacking engine with property tests.
4. Bill quote → create → pay (Razorpay order, idempotent) → webhook → `BillPaid` outbox → ledger posting.
5. Verification pass (TOTP code, server clock) + partner Live feed (SSE) + match / mismatch / dispute.
6. Settlement run (weekly, Route transfer or manual UTR as today) + PDF statement from the ledger.
7. Receipt PDF (reuse `pdfkit` setup), emails (reuse `mail.templates`), WhatsApp/SMS for receipts.
8. Risk rules v1, nightly reconciliation, dashboards.

---

## 14. Decisions needed from you

1. **API host.** Is production already on `api.tixit.in`? If not, P0 moves it. SSO depends on this.
2. **Workspaces on Hostinger.** OK to restore npm workspaces, subject to the P0 spike?
3. **SMS / WhatsApp provider** for phone OTP and receipts (MSG91, Gupshup or Interakt), plus DLT registration.
4. **Razorpay Route.** Needs to be enabled on the merchant account. Until it is, settlement records manual UTRs, as event payouts already do.
5. **Launch city / clusters** and the default commission (the research supports 4–12% of net sales; we suggest **6%** with the first 90 days free).
6. **Cashback in P3**: Tixit Wallet shared across events and dining (recommended), or dining-only?
