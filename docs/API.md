# Tixit API Reference

Base URL: `http://localhost:4000/api/v1`

## Conventions

Every response shares one envelope.

```jsonc
// success
{ "success": true, "data": { ... } }

// paginated
{ "success": true, "data": [ ... ], "meta": { "page": 1, "limit": 12, "total": 48, "totalPages": 4, "hasNext": true } }

// error
{ "success": false, "error": { "code": "INSUFFICIENT_INVENTORY", "message": "Only 2 ticket(s) left", "details": { "available": 2 }, "requestId": "…" } }
```

Branch on `error.code`, never on `error.message`.

**Money** — every `*Paise` field is an integer number of paise (₹1 = 100 paise).
**Auth** — send `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes; refresh
tokens rotate on every use and are also set as an httpOnly cookie.

Common error codes: `VALIDATION_ERROR` (422), `UNAUTHORIZED`/`TOKEN_EXPIRED` (401),
`FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT`/`INSUFFICIENT_INVENTORY` (409),
`RATE_LIMITED` (429), `SIGNATURE_MISMATCH` (402).

---

## Auth — `/auth`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/register` | — | Start a signup. Holds the details and emails a code — **no account is created here**. |
| POST | `/login` | — | Email + password. Returns user, access and refresh tokens. |
| POST | `/otp/request` | — | Email a one-time code. Never reveals whether the address exists. |
| POST | `/otp/verify` | — | Verify a code; creates the account (`signup`), signs in, verifies email, or resets a password. |
| POST | `/refresh` | — | Rotate the refresh token, mint a new access token. |
| POST | `/logout` | — | Revoke the supplied refresh token. |
| GET | `/me` | ✔ | Current user with organizer profile if any. |
| PATCH | `/me` | ✔ | Update name, phone, avatar, home city. |
| POST | `/change-password` | ✔ | Change password; revokes every session. |

### Signup is two steps

Email verification is mandatory. `POST /auth/register` does **not** create a user: it parks the
submitted details in `pending_registrations` and emails a 6-digit code. The `users` row is created
by `POST /auth/otp/verify` with `purpose: "signup"`, which returns a session like `/auth/login`.

An address that is never verified therefore has no account at all — it cannot sign in, does not
appear in admin, and does not hold the email/phone unique indexes. Pending rows expire after 24
hours and are deleted by the `purge-pending-registrations` job.

```http
POST /auth/register
{ "fullName": "Aarav Sharma", "email": "aarav@example.com", "password": "hunter2secure",
  "phone": "9876543210", "role": "organizer", "organizerName": "Nova Live" }

→ 201 { "email": "aarav@example.com", "otpSent": true }
```

```http
POST /auth/otp/verify
{ "email": "aarav@example.com", "code": "482913", "purpose": "signup" }

→ 200 { "user": { … }, "accessToken": "…", "refreshToken": "…" }
```

`POST /auth/otp/request` with `purpose: "signup"` resends the code and extends the pending row's
lifetime. Signing in with the correct password for an unverified signup returns `403
EMAIL_NOT_VERIFIED` so the client can route back to the code screen.

Rate limits: 20 attempts / 15 min per email on credential routes; 5 / 10 min on OTP requests.

---

## Catalog — `/catalog`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/cities` | — | Cities with live-event counts. `?popular=true` to filter. |
| GET | `/categories` | — | Active categories with counts, icon and colour. |
| GET | `/venues` | organizer | Shared venues plus the caller's own. |
| POST | `/venues` | organizer | Create a venue. |

---

## Events — `/events` (public)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | Search and filter published events. |
| GET | `/home` | Home feed: trending, upcoming, featured, free, cities, categories. |
| GET | `/:slug` | Full event detail with ticket tiers. |
| GET | `/:id/availability` | Live tier availability (polled during checkout). |

**Query parameters for `GET /events`**

| Param | Values | Notes |
| --- | --- | --- |
| `q` | text | Full-text over title, tagline, tags, description; also matches venue name |
| `city` | slug or uuid | |
| `category` | slug or uuid | |
| `when` | `today` `tomorrow` `weekend` `this_week` `this_month` | Evaluated in IST |
| `date` | `YYYY-MM-DD` | Single day |
| `from` / `to` | ISO datetime | Explicit range; beats `date` and `when` |
| `price` | `free` `paid` | |
| `minPrice` / `maxPrice` | rupees | |
| `featured` | `true` | |
| `organizer` | slug or uuid | |
| `tag` | text | |
| `sort` | `date` `relevance` `popular` `price_low` `price_high` `newest` | Default `date` |
| `page` / `limit` | ints | `limit` max 50 |

```http
GET /events?q=jazz&city=mumbai&when=weekend&price=paid&sort=price_low&page=1
```

---

## Organizer events — `/organizer/events` (organizer)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | The caller's events, filterable by status. |
| POST | `/` | Create an event (verified organizers only). Accepts inline venue and tiers. |
| GET | `/:id` | Full detail including unpublished. |
| PATCH | `/:id` | Update the listing. |
| DELETE | `/:id` | Delete — refused once confirmed bookings exist. |
| POST | `/:id/submit` | Submit for admin review. |
| POST | `/:id/pause` · `/:id/resume` | Stop / restart bookings on a live event. |
| GET | `/:id/ticket-types` | List tiers. |
| POST | `/:id/ticket-types` | Add a tier. |
| PATCH | `/:id/ticket-types/:ticketTypeId` | Update a tier. Capacity cannot drop below sold + held. |
| DELETE | `/:id/ticket-types/:ticketTypeId` | Delete — refused once any are sold. |

Lifecycle: `draft → pending_review → published ⇄ paused → completed`, with `rejected` and
`cancelled` as terminal branches.

```http
POST /organizer/events
{ "title": "Sunburn Arena", "categoryId": "…", "startsAt": "2026-09-01T14:00:00Z",
  "endsAt": "2026-09-01T19:00:00Z",
  "venue": { "name": "Jio World Garden", "addressLine1": "BKC", "cityId": "…" },
  "ticketTypes": [ { "name": "Early Bird", "kind": "early_bird", "price": 1499,
                     "quantityTotal": 300, "maxPerOrder": 4 } ] }
```

Ticket `kind`: `regular` · `vip` · `early_bird` · `couple_pass` · `group_pass`.
`price` is in **rupees** on input; everything else is paise.

---

## Bookings — `/bookings` (authenticated)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/quote` | Price a cart, including coupon preview. Reserves nothing. |
| POST | `/` | Create a booking and **hold inventory**. |
| GET | `/` | Booking history. `?scope=upcoming\|past\|all`. |
| GET | `/:id` | Full booking with items, tickets and payments. |
| GET | `/:id/tickets` | QR tickets (payload + PNG data URL). |
| POST | `/:id/cancel` | Cancel; opens a refund request if money was captured. |
| POST | `/:id/refund-request` | Request a refund on a confirmed booking. |

```http
POST /bookings
{ "eventId": "…", "items": [ { "ticketTypeId": "…", "quantity": 2 } ],
  "couponCode": "WELCOME10", "customerName": "Aarav Sharma",
  "customerEmail": "aarav@example.com", "customerPhone": "9876543210" }
```

```jsonc
{ "success": true,
  "data": { "id": "…", "bookingCode": "EVT-8FK2M4", "status": "pending",
            "totalPaise": 64584, "holdExpiresAt": "2026-08-09T12:15:00Z",
            "requiresPayment": true,
            "breakdown": { "subtotalPaise": 59800, "discountPaise": 5980, "taxPaise": 9688,
                           "convenienceFeePaise": 1076, "totalPaise": 64584,
                           "commissionPaise": 5382, "organizerPayoutPaise": 48438 } } }
```

Free events skip payment and return `status: "confirmed"` immediately.

Booking rules enforced server-side: sale window, `minPerOrder`/`maxPerOrder`, per-customer
cumulative limit, live availability, event status and start time.

---

## Payments — `/payments`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/checkout` | ✔ | Create (or reuse) the gateway order for a pending booking. |
| POST | `/verify` | ✔ | Verify the checkout signature and confirm the booking. |
| POST | `/failed` | ✔ | Record a client-side failure. |
| POST | `/webhook` | HMAC | Razorpay webhook. Idempotent; verified over the raw body. |

`POST /checkout` returns `mockMode: true` plus `mockPaymentId` and `mockSignature` when Razorpay
is not configured, so the same client code completes the flow locally.

```http
POST /payments/verify
{ "bookingId": "…", "razorpayOrderId": "order_…", "razorpayPaymentId": "pay_…",
  "razorpaySignature": "…" }
```

An invalid signature returns `402 SIGNATURE_MISMATCH` and marks the payment failed.

---

## Tickets — `/tickets` (authenticated)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/booking/:bookingId/download` | PDF of every ticket, one page each with its QR. |

---

## Organizer console — `/organizer` (organizer)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/profile` · PATCH `/profile` | Public profile and business details. |
| GET | `/dashboard` | Summary, 30-day sales series, event performance. |
| GET | `/reports?days=30` | Same, over a chosen window. |
| GET | `/bookings` | Attendees, filterable by event, status and free text. |
| GET | `/bookings/export` | **CSV** of attendees (`?eventId=` to scope). |
| POST | `/checkin` | Scan a QR payload — or a manually typed ticket code — and admit the holder. |
| POST | `/checkin/lookup` | Look a ticket up without admitting it. Accepts either form. |
| POST | `/checkin/:ticketId/undo` | Reverse an accidental scan. |
| GET | `/events/:id/checkin-stats` | Live attendance counters. |

```http
POST /organizer/checkin
{ "payload": "TKT-9QP4X7R2.4f3c…", "eventId": "…" }

// Manual entry sends the bare code printed on the ticket. The `TKT-` prefix,
// letter case and stray spaces are all optional — "9qp4 x7r2" works too.
{ "payload": "TKT-9QP4X7R2", "eventId": "…" }
```

A scanned QR carries an HMAC signature bound to the event, which is verified
before admission. A typed code has no signature to verify — it is authenticated
by the code itself plus the organizer session, which must own the event.

```jsonc
{ "success": true,
  "data": { "status": "admitted", "message": "Welcome, Aarav Sharma",
            "ticket": { "ticketCode": "TKT-9QP4X7R2", "attendeeName": "Aarav Sharma",
                        "ticketTypeName": "VIP Lounge", "bookingCode": "EVT-8FK2M4" } } }
```

`status` is one of `admitted` · `already_used` · `invalid` · `wrong_event` · `cancelled`.

---

## Admin console — `/admin` (admin)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/dashboard` · `/reports?days=` | Platform revenue, commission, users, top events, categories. |
| GET | `/reports/export` | **CSV** of every booking with full financial breakdown. |
| GET | `/events` | Moderation queue; `?status=pending_review`. |
| POST | `/events/:id/approve` | Publish and notify the organizer. |
| POST | `/events/:id/reject` | Reject with a reason (emailed to the organizer). |
| POST | `/events/:id/feature` | Toggle featured placement. |
| POST | `/events/:id/cancel` | Cancel a live event. |
| GET | `/organizers` | Directory with revenue and verification state. |
| POST | `/organizers/:id/verify` | Verify and notify. |
| POST | `/organizers/:id/status` | Set pending / verified / rejected / suspended. |
| POST | `/organizers/:id/commission` | Per-organizer override; `null` restores the default. |
| GET | `/users` | Directory filterable by role and status. |
| POST | `/users/:id/status` | Activate / suspend. Suspension revokes sessions immediately. |
| GET · POST · PATCH · DELETE | `/coupons` | Full coupon management. |
| GET | `/refunds` | Refund queue; `?status=requested`. |
| POST | `/refunds/:id/approve` | Approve **and** execute against the gateway. |
| POST | `/refunds/:id/reject` | Decline with a note. |
| GET · PATCH | `/settings` | Commission, GST, fees, hold window, refund window, auto-approve. |
| GET | `/audit-logs` | Append-only trail of privileged actions. |

```http
POST /admin/coupons
{ "code": "SUMMER25", "type": "percent", "value": 25, "maxDiscount": 500,
  "minOrder": 1000, "usageLimitTotal": 1000, "usageLimitPerUser": 1,
  "validUntil": "2026-12-31T23:59:59Z" }
```

For coupons, `value` is a percentage when `type` is `percent`, and **rupees** when `type` is
`flat`; `maxDiscount` and `minOrder` are always rupees.

---

## Uploads — `/uploads` (organizer)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/image` | `multipart/form-data` with `file` and optional `folder`. |

JPEG, PNG, WebP or AVIF, up to 8 MB, validated by file signature rather than the declared
content type. Returns a Cloudinary URL, or a local `/uploads/...` URL when Cloudinary is unset.

---

## Health

`GET /health` — liveness plus which integration mode each service is in.

```jsonc
{ "success": true,
  "data": { "status": "ok", "database": "up",
            "integrations": { "razorpay": "mock", "email": "console", "storage": "local" } } }
```
