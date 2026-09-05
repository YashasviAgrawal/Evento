# Architecture

How Tixit is put together, and why the load-bearing decisions were made the way they were.

---

## 1. Shape of the system

```
┌──────────────────┐        ┌─────────────────────┐        ┌──────────────┐
│  Next.js 15      │  REST  │  Express 4 API      │  SQL   │ PostgreSQL 16│
│  App Router      │ ─────► │  (TypeScript)       │ ─────► │              │
│  Tailwind CSS    │        │                     │        │  • row locks │
│                  │ ◄───── │  JWT + RBAC         │ ◄───── │  • CHECKs    │
└──────────────────┘        └─────────┬───────────┘        └──────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
                Razorpay           Resend          Cloudinary
              (or signed mock)   (or console)    (or local disk)
```

Public pages are React Server Components that fetch from the API at request time and revalidate on
a short window; everything behind a login is a client component talking to the same API with a
bearer token. There is one API surface, used identically by both.

Each integration has a **local fallback** chosen so the fallback exercises the same code path as
the real thing. The Razorpay mock, for instance, signs orders with the same
`HMAC(order_id|payment_id)` construction Razorpay uses, and the server verifies it with the same
function — so "it works locally" is evidence that the production path works too.

---

## 2. Data model

Twenty tables. The core chain is `users → organizers → events → ticket_types → bookings →
booking_items → tickets`, with `payments`, `refunds` and `coupons` hanging off bookings.

```
users ──1:1── organizers ──1:N── events ──1:N── ticket_types
  │                                 │                 │
  │                                 │                 │
  └──1:N── bookings ────────────────┘                 │
             │  │                                     │
             │  └──1:N── booking_items ───────────────┘
             │              │
             │              └──1:N── tickets  (one QR each)
             ├──1:N── payments ──1:N── payment_events   (webhook ledger)
             ├──1:N── refunds
             └──1:1── coupon_redemptions ──N:1── coupons

cities ──< events, venues, users        settings     (runtime business rules)
categories ──< events                   notifications (email outbox + sent-log)
venues ──< events                       audit_logs   (privileged actions)
refresh_tokens, otp_codes               (auth)
```

### Conventions

- **UUID primary keys** via `gen_random_uuid()` — core in PG13+, no extension needed.
- **Money is integer paise in `BIGINT`.** Never a float, never a `NUMERIC` that someone might
  read into a JS float. `Number.MAX_SAFE_INTEGER` is ~₹90 trillion, so parsing to a JS number in
  the driver is safe and is done deliberately in `db/pool.ts`.
- **`updated_at` is maintained by a trigger**, not by application code, so it cannot be forgotten.
- **Enums are PostgreSQL enums**, so an invalid status is rejected by the database.

### Why raw SQL and not an ORM

The booking path needs `SELECT … FOR UPDATE` with a deterministic lock order, a conditional
`UPDATE … WHERE status = 'pending'`, and a CHECK constraint doing real work. Those are precisely
the things ORMs abstract away or make awkward. Everywhere else the queries are simple enough that
an ORM would add indirection without removing any.

Migrations are plain `.sql` applied by a small forward-only runner that records a checksum, so an
edited-after-the-fact migration is detected rather than silently diverging between environments.

### Denormalisation, deliberately

`events` carries `min_price_paise`, `max_price_paise`, `total_capacity` and `tickets_sold`, all
recomputed by `recalculateEventAggregates` after any ticket-type change. This lets the discovery
query filter and sort by price without joining or sub-selecting `ticket_types` — the difference
between an index scan and a join on the hottest query in the product.

`booking_items` snapshots `ticket_type_name` and `unit_price_paise`. An organizer renaming or
repricing a tier must not retroactively change what a customer already paid for.

---

## 3. The booking engine

The heart of the system, in `modules/bookings/booking.service.ts`.

```
POST /bookings
  │
  ├─ opportunistic sweep of lapsed holds (frees seats abandoned seconds ago)
  │
  └─ BEGIN
      ├─ load event, assert published and not started
      ├─ merge duplicate line items          ← stops split-order cap evasion
      ├─ SELECT … FROM ticket_types
      │    WHERE id = ANY($2) ORDER BY id
      │    FOR UPDATE                        ← deterministic lock order
      ├─ per line: sale window, min/max per order,
      │            per-customer cumulative cap, availability
      ├─ evaluate coupon (FOR UPDATE on the coupon row)
      ├─ calculatePricing(...)               ← same function the quote used
      ├─ INSERT booking + booking_items
      ├─ UPDATE ticket_types SET quantity_held = quantity_held + n
      │                                      ← CHECK constraint fires here if oversold
      └─ COMMIT
```

**Three independent guarantees against overselling:**

1. Row locks acquired in `id` order — concurrent buyers queue rather than deadlock.
2. Availability computed *under* the lock, so the number read is authoritative.
3. `CHECK (quantity_sold + quantity_held <= quantity_total)` — the transaction aborts even if the
   application logic above it is wrong.

**State machine**

```
pending ──confirm──► confirmed ──cancel──► cancelled (+ refund request)
   │                     │
   │                     └──refund──► partially_refunded ──► refunded
   ├──hold lapses──► expired
   └──cancel──► cancelled
```

`quantity_held` tracks pending bookings, `quantity_sold` tracks confirmed ones. Confirmation moves
a quantity from held to sold in one transaction; expiry and pre-payment cancellation just decrement
held. Availability is always `total − sold − held`.

**Idempotency.** `confirmBooking` is a guarded UPDATE matching only `status = 'pending'`. A webhook
and a client-side verify arriving together cannot both succeed, so inventory is never
double-decremented and tickets are never issued twice.

---

## 4. Pricing

One function, `modules/bookings/pricing.ts`, called by both the quote endpoint and the booking
transaction. A quote can therefore never disagree with the charge.

```
subtotal            = Σ (unit_price × quantity)
discount            = coupon, capped at subtotal
taxable             = subtotal − discount
tax                 = taxable × gst%              ← post-discount, per Indian GST rules
convenience_fee     = taxable × fee%
total (customer)    = taxable + tax + convenience_fee
commission (platform) = taxable × commission%
payout (organizer)  = taxable − commission
```

Every step rounds half-up to whole paise, so the parts always reconstruct the whole.

`commission_percent`, `commission_paise` and `organizer_payout_paise` are **written onto the
booking row** at creation. Changing the platform commission tomorrow cannot rewrite yesterday's
revenue reports.

---

## 5. Payments

```
client                    API                         Razorpay
  │  POST /payments/checkout │                            │
  │ ────────────────────────►│  create order (or reuse) ──►│
  │ ◄──────────────────────  │◄─── order_id ──────────────│
  │                          │                            │
  │  open checkout ──────────┼───────────────────────────►│
  │ ◄──── order_id, payment_id, signature ────────────────│
  │                          │                            │
  │  POST /payments/verify   │                            │
  │ ────────────────────────►│ HMAC(order|payment) check  │
  │                          │ confirmBooking()           │
  │ ◄──── confirmed ─────────│                            │
                             │◄── webhook (safety net) ───│
```

- Reusing an existing `created` payment row stops a page reload from minting a second gateway
  order for the same booking.
- The webhook is verified over the **raw request body** — `express.raw` is mounted on that path
  before `express.json`, because re-serialising parsed JSON changes byte order and breaks the HMAC.
- `payment_events` has `UNIQUE (provider, provider_event_id)`; a replayed delivery hits the
  constraint and returns early. Razorpay retries aggressively, so this matters.
- The webhook is also the recovery path for a customer whose browser closed after paying.
- Refunds are never automatic: cancelling a paid booking opens a `refunds` row for admin review,
  and approval executes the gateway refund in the same action so money cannot sit in limbo.

---

## 6. Tickets and check-in

One `tickets` row per ticket purchased. A Couple or Group Pass is a single ticket that admits
`seats_per_ticket` people, recorded in the seat label so gate staff know how many to let in.

The QR encodes `TKT-XXXXXXXX.<hmac>` where the HMAC covers **ticket code + event id**:

- a fabricated code fails signature verification before any database round trip;
- a genuine ticket for event A cannot be replayed at event B.

Admission is `UPDATE tickets SET status='used' WHERE id=$1 AND status='valid' RETURNING …`.
Because the check and the transition are the same statement, exactly one of two simultaneous scans
can match a row — the other is told "already used". Scanning is additionally scoped: only the
event's own organizer (or an admin) may admit its attendees.

The scanner UI decodes frames client-side with `jsQR` and always offers manual code entry, so a
denied camera permission never blocks the door.

---

## 7. Auth

- **Access tokens**: short-lived JWTs (15 min), `HS256`, issuer/audience pinned.
- **Refresh tokens**: opaque random strings, stored only as SHA-256 digests, rotated on every use.
  A stolen token is usable at most once, and the legitimate client's next refresh fails — which
  surfaces the compromise instead of hiding it.
- **Re-read on every request.** The middleware loads the user row rather than trusting JWT claims,
  so suspending an account takes effect immediately rather than at token expiry.
- **OTP**: six digits, bcrypt-hashed, single-use, expiring, with an attempt counter that burns the
  code after too many wrong guesses. Requesting a new code invalidates the previous one.
- **Enumeration resistance**: login always runs a bcrypt comparison even when no user exists, so
  response timing does not reveal registered addresses; OTP requests always report success.

RBAC is layered: `authenticate` → `requireRole` → `requireOrganizer` → `requireVerifiedOrganizer`,
with per-resource ownership checks (`assertEventOwnership`) on top. The client-side `RequireAuth`
guard is a UX affordance only — every endpoint authorises independently.

---

## 8. Discovery and search

`events.search_vector` is a **stored generated column** combining title (weight A), tagline and
tags (B) and description (C), indexed with GIN. Queries use `websearch_to_tsquery`, which tolerates
the quoting and `OR`/`-` syntax users actually type, with an `ILIKE` arm to catch partial words
that stemming misses (`jaz` → `jazz`).

One wrinkle worth recording: PostgreSQL marks `array_to_string()` `STABLE`, not `IMMUTABLE`, so it
cannot appear in a generated column. `evento_tags_to_text()` is a thin `IMMUTABLE` wrapper — sound
here because the array is `text[]`, whose output is genuinely deterministic.

Filters are assembled by a small builder that returns a positional placeholder for every value, so
user input is never concatenated into SQL. Date filters (`today`, `tomorrow`, `weekend`) resolve in
IST, because "today" for a customer in Mumbai is not "today" in UTC after 18:30.

---

## 9. Background jobs

In-process timers (`jobs/scheduler.ts`), each wrapped so a failure logs and the timer survives:

| Job | Interval | Purpose |
| --- | --- | --- |
| Release expired holds | 1 min | Return seats from abandoned checkouts |
| Complete finished events | 15 min | Move past events to `completed` |
| Event reminders | 30 min | Email ~24h before start |
| Purge expired OTPs | 6 h | Housekeeping |

Reminders are deduplicated by querying the `notifications` table, which doubles as the sent-log —
so the same customer is not reminded on every tick.

At this scale a queue would be unnecessary complexity. Behind more than one API instance these
need an advisory lock or a dedicated worker; that is the documented upgrade path, not a hidden
assumption.

---

## 10. Frontend

**Server components** render the public pages (home, listing, detail) with a short revalidation
window: fast first paint, SEO-visible content, and JSON-LD `Event` structured data on detail pages.
**Client components** handle everything interactive and everything behind a login.

Filter state lives entirely in the URL query string, which makes every result set shareable and
bookmarkable and keeps the server component the single source of truth for what is displayed.

`lib/api.ts` is the one network boundary: typed helpers, a normalised `ApiError` carrying the
machine-readable code, and a single transparent refresh-and-retry on `TOKEN_EXPIRED` so a
15-minute token never surfaces as a spurious "please sign in" mid-checkout.

**Hydration.** Auth state lives in `localStorage`, which the server cannot see, so any
auth-dependent UI must render its signed-out shell on the first client pass. A provider-level flag
is not enough: with streaming hydration a nested `<Suspense>` boundary hydrates *after* its
parent's effects have run, so by then the context may already report a signed-in user while the
server HTML says otherwise. The `useMounted()` hook solves this at the consuming component — its
own effect cannot run before its own first render, so that render always matches the server.

Charts are hand-rolled SVG. A charting library would have added ~100 KB and a React 19 peer
conflict for what amounts to two shapes; the hand-rolled version also carries a text summary for
screen readers.

---

## 11. Security summary

| Concern | Mitigation |
| --- | --- |
| SQL injection | Parameterised everywhere; the filter builder cannot emit a literal |
| Password storage | bcrypt |
| Token theft | Refresh tokens hashed at rest, rotated on use, httpOnly cookie |
| Session revocation | User re-read per request; suspension revokes refresh tokens |
| Brute force | Rate limits keyed by email, not just IP; OTP attempt counter |
| Account enumeration | Constant-time login path; OTP always reports success |
| Payment forgery | HMAC signature verified server-side before confirmation |
| Webhook replay | Unique constraint on the provider event id |
| Ticket forgery | HMAC bound to code + event; single-use conditional UPDATE |
| CSV injection | Leading `=`, `+`, `-`, `@` neutralised on export |
| Malicious uploads | Magic-number validation, generated filenames, size and type caps |
| XSS | React escaping; no `dangerouslySetInnerHTML` outside static JSON-LD |
| Clickjacking | `X-Frame-Options: DENY`, Helmet defaults |
| Error leakage | 5xx details logged server-side, generic message returned |

---

## 12. Known limits

Honest boundaries of the current build:

- **Single-instance assumptions**: in-memory rate limiting and in-process jobs. Both have a
  documented upgrade path (Redis store, dedicated worker).
- **No seat-level allocation**: `tickets.seat_label` exists and is populated, but there is no seat
  map. This is a listed future feature.
- **Payouts are calculated, not disbursed**: `organizer_payout_paise` is computed and reported per
  booking; actually moving money to organizers would need Razorpay Route or a settlement process.
- **Refunds are admin-gated by design** — matching the PRD's "Refund Approval" requirement rather
  than refunding automatically.
- **Email only**: `notifications` is channel-agnostic, but only the email channel is implemented.
