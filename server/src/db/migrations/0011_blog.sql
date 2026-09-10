-- ============================================================================
-- Editorial blog.
--
-- Organic search is the cheapest acquisition channel this platform has, but an
-- event listing is a poor landing page for it: the page dies the day the show
-- ends, so every ranking it earns decays with it. Articles do not expire, so
-- they are what accumulates authority for the domain and what carries a reader
-- from an informational query ("things to do in Jaipur this weekend") to a
-- transactional one (a booking).
--
-- Posts live in the database rather than in MDX files in the repo so that an
-- admin can publish, correct a fact, or retitle for a keyword without a deploy
-- — the same reason categories, cities and settings are rows and not code.
--
-- Content is stored as Markdown. It is the portable choice: it survives a
-- change of renderer, it diffs readably, and it cannot smuggle a <script> into
-- a page the way stored HTML could.
--
-- The SEO-specific columns (meta_title, meta_description, canonical_url,
-- og_image_url, focus_keyword, faq) exist because the on-page title a reader
-- sees and the <title> that wins a click in a search result are different
-- pieces of writing with different length budgets, and conflating them costs
-- one or the other. `faq` renders as FAQPage structured data, which is what
-- earns the expandable answers under a result.
-- ============================================================================

CREATE TYPE blog_post_status AS ENUM ('draft', 'published', 'archived');

-- ─────────────────────────── categories ───────────────────────────

CREATE TABLE blog_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER blog_categories_set_updated_at BEFORE UPDATE ON blog_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ───────────────────────────── posts ─────────────────────────────

CREATE TABLE blog_posts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  excerpt          TEXT NOT NULL DEFAULT '',
  content          TEXT NOT NULL DEFAULT '',
  category_id      UUID REFERENCES blog_categories (id) ON DELETE SET NULL,
  cover_image_url  TEXT,
  cover_image_alt  TEXT,
  author_name      TEXT NOT NULL DEFAULT 'Tixit Editorial',
  author_id        UUID REFERENCES users (id) ON DELETE SET NULL,
  status           blog_post_status NOT NULL DEFAULT 'draft',
  is_featured      BOOLEAN NOT NULL DEFAULT false,
  tags             TEXT[] NOT NULL DEFAULT '{}',

  -- SEO overrides. Each falls back to its on-page counterpart when null, so a
  -- post is publishable without filling any of them in.
  meta_title       TEXT,
  meta_description TEXT,
  canonical_url    TEXT,
  og_image_url     TEXT,
  focus_keyword    TEXT,
  -- [{ "question": "...", "answer": "..." }] → schema.org/FAQPage
  faq              JSONB NOT NULL DEFAULT '[]'::jsonb,

  view_count       INTEGER NOT NULL DEFAULT 0,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Derived rather than supplied: an author editing a paragraph should never
  -- have to remember to correct the "6 min read" label underneath it.
  -- 200 wpm is the usual reading-speed assumption for prose.
  reading_minutes  INTEGER GENERATED ALWAYS AS (
    GREATEST(1, ceil(coalesce(array_length(regexp_split_to_array(btrim(content), '\s+'), 1), 0) / 200.0)::integer)
  ) STORED,

  search_vector    tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(evento_tags_to_text(tags), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) STORED,

  -- A post cannot be published without a date; the listing sorts on it and the
  -- article markup needs a datePublished.
  CONSTRAINT blog_posts_published_needs_date
    CHECK (status <> 'published' OR published_at IS NOT NULL)
);

-- The listing query is always "published, newest first", optionally narrowed by
-- category. A partial index keeps drafts out of the hot path entirely.
CREATE INDEX blog_posts_published_idx  ON blog_posts (published_at DESC)
  WHERE status = 'published';
CREATE INDEX blog_posts_category_idx   ON blog_posts (category_id, published_at DESC)
  WHERE status = 'published';
CREATE INDEX blog_posts_featured_idx   ON blog_posts (published_at DESC)
  WHERE status = 'published' AND is_featured = true;
CREATE INDEX blog_posts_search_idx     ON blog_posts USING GIN (search_vector);
CREATE INDEX blog_posts_tags_idx       ON blog_posts USING GIN (tags);

CREATE TRIGGER blog_posts_set_updated_at BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────── seed: categories ───────────────────────

INSERT INTO blog_categories (name, slug, description, display_order) VALUES
  ('City Guides',    'city-guides',
   'What is on in your city — the shows, the venues and the weekends worth planning around.', 10),
  ('For Organizers', 'for-organizers',
   'Practical guides to selling out an event: pricing, promotion, ticketing and on-ground operations.', 20),
  ('Ticketing Tips', 'ticketing-tips',
   'How to book smarter — spotting fakes, understanding fees, refunds and entry rules.', 30),
  ('Event Trends',   'event-trends',
   'What is changing in live entertainment in India, and what it means for fans and organizers.', 40)
ON CONFLICT (slug) DO NOTHING;

-- ───────────────────────── seed: posts ─────────────────────────
--
-- Six launch articles, deliberately split between the two audiences the site
-- sells to: fans searching for something to do (city guides, booking help) and
-- organizers searching for how to run a show (pricing, promotion, ticketing).
-- Each one links inward to a listing or signup page, because an article that
-- ranks but never hands the reader onward is a vanity metric.
--
-- published_at is backdated across several weeks. A blog whose entire archive
-- shares one timestamp reads as bulk-generated to a reader and to a crawler.

INSERT INTO blog_posts (
  title, slug, excerpt, content, category_id, cover_image_url, cover_image_alt,
  author_name, status, is_featured, tags, meta_title, meta_description,
  focus_keyword, faq, published_at
)
SELECT
  v.title, v.slug, v.excerpt, v.content,
  (SELECT id FROM blog_categories WHERE slug = v.category_slug),
  v.cover_image_url, v.cover_image_alt, 'Tixit Editorial', 'published',
  v.is_featured, v.tags, v.meta_title, v.meta_description, v.focus_keyword,
  v.faq::jsonb, v.published_at::timestamptz
FROM (VALUES

-- ── 1. Things to do in Jaipur this weekend ──────────────────────────────────
(
  'Things to Do in Jaipur This Weekend: A Local''s Guide',
  'things-to-do-in-jaipur-this-weekend',
  'Jaipur packs more into a Saturday than most cities manage in a month — rooftop gigs, open-mic comedy, heritage walks and food trails. Here is how to plan a weekend that is actually worth leaving the house for.',
  $md$
Jaipur has quietly stopped being a city you visit for two days and tick off. Between the heritage circuit and the new wave of rooftop venues, co-working cafés and independent promoters, there is now enough happening on any given Saturday that the hard part is choosing.

This guide is organised the way people actually plan a weekend: by mood and by budget, not by monument. Everything here recurs — so it stays useful whether you are reading it in October or in April.

## Start by checking what is actually on

Before committing to a plan, it is worth seeing what is scheduled. Ticketed events in the city move fast: a comedy show announced on Monday can be sold out by Thursday.

- [Everything happening in Jaipur](/events?city=jaipur) — the full listing
- [Events today](/events?when=today) — for when the weekend has already started
- [This weekend](/events?when=weekend) — Friday evening through Sunday night
- [Free events](/events?price=free) — more of these than most people expect

## Friday evening: live music and comedy

Friday in Jaipur belongs to the rooftops. The city's terrace venues run acoustic sets, indie showcases and the occasional touring act, and the format suits the weather for most of the year — anything from October to March is close to perfect for an open-air gig.

**What to expect on the ticket price.** A local acoustic night typically lands between ₹300 and ₹700, usually with a cover charge redeemable against food and drink. A touring headliner from Delhi or Mumbai is more like ₹800 to ₹2,000. Anything advertised well above that in Jaipur is usually a festival slot rather than a club show.

**Comedy is the other Friday staple.** The open-mic circuit here is genuinely strong, and it is cheap — ₹200 to ₹400 gets you a two-hour lineup. Established touring comics announce Jaipur dates a few weeks out and those do sell out. If a name you recognise is playing, book the week it goes on sale rather than the week of the show.

Browse [music events](/events?category=music) and [comedy shows](/events?category=comedy) to see what is scheduled.

## Saturday morning: the heritage circuit, done properly

The mistake most people make is trying to do Amer Fort, City Palace, Hawa Mahal and Jantar Mantar in one day. You will spend the day in traffic and remember none of it.

A better Saturday morning:

1. **Be at Amer Fort by 8 am.** It opens at 8, and the first hour is the only hour it is not crowded. The light is also better for photographs.
2. **Nahargarh Fort for late morning.** The views over the city are the reason to go, and the drive up is part of it.
3. **Stop at Panna Meena ka Kund** on the way back down — a stepwell near Amer that most tour itineraries skip.

If you would rather have someone else do the planning, guided heritage and photography walks run most weekends. They tend to be small groups, run three to four hours, and cost ₹500 to ₹1,500 depending on whether entry tickets are included. Look under [workshops and experiences](/events?category=workshop).

## Saturday afternoon: workshops, markets and indoor escapes

Jaipur summers are not for the outdoors, and even in winter the middle of the day is better spent inside.

- **Pottery, block printing and blue pottery workshops.** Sanganer and Bagru, on the outskirts, are the traditional block-printing centres, and several studios run half-day sessions for visitors. Expect ₹800 to ₹2,500 including materials, and expect to take home what you make.
- **Bapu Bazaar and Johari Bazaar.** For textiles, juttis and silver. Go with a rough sense of what things should cost; the first price quoted is rarely the last.
- **The museums.** Albert Hall is the obvious one. The Jawahar Kala Kendra is the one worth going out of your way for — it programmes theatre, exhibitions and film through the year.

## Saturday night: the main event

This is where the weekend either works or does not. Jaipur's Saturday night has three broad options:

**Ticketed shows.** Concerts, standup, theatre at Jawahar Kala Kendra, or a club night with a booked DJ. These are worth booking in advance — walk-in availability on a Saturday is unreliable and door prices are usually higher than advance.

**Cultural evenings.** Chokhi Dhani is the well-known one, and it is genuinely enjoyable if you go in expecting a curated village experience rather than an authentic one. Budget ₹1,000 to ₹1,500 per head with dinner.

**A long dinner.** Jaipur's food scene has outgrown its reputation. The old-city institutions — Laxmi Misthan Bhandar, Rawat for pyaaz kachori — are worth the queue. For dinner, the rooftop restaurants around the old city trade a slightly ordinary menu for a genuinely extraordinary view of Hawa Mahal lit up, and that is a fair trade once.

## Sunday: slow down

Sunday in Jaipur is best spent not achieving anything.

- **A morning at Jal Mahal or Central Park** — Central Park has a proper walking track and is where the city goes to run.
- **Sunday brunches** run at most of the larger hotels and several independent cafés, typically ₹1,200 to ₹2,500.
- **Flea markets and pop-ups** appear through the winter season, particularly around the festival months. These are usually free entry and worth an hour.

## A realistic budget

| Weekend style | Per person, two days |
| --- | --- |
| Free and low-cost — parks, bazaars, one free event | ₹500 – ₹1,000 |
| Standard — one ticketed show, two good meals, a workshop | ₹2,500 – ₹4,000 |
| Full weekend — concert, heritage walk, brunch, dinners | ₹5,000 – ₹8,000 |

Entry to the major monuments runs ₹50 to ₹500 depending on the site and whether you are an Indian or foreign national. A composite ticket covering several sites usually works out cheaper than paying at each gate if you are visiting three or more.

## When to visit, if you have the choice

**October to March** is the season. Comfortable weather, and it is when the events calendar is busiest — the literature festival, the major music dates and most outdoor programming cluster here.

**April to June** is hot enough that outdoor plans stop being pleasant by 10 am. The upside is that hotels are cheap and the forts are empty.

**July to September** brings the monsoon, Teej and a green Aravalli backdrop that most visitors never see. Teej in particular is worth planning a trip around.

## Practical notes

- **Book the popular things in advance.** Comedy and touring music sell out. Heritage walks cap group sizes.
- **Autos and cabs.** App-based cabs work well. For autos, agree the fare before getting in.
- **Winter evenings get genuinely cold.** A rooftop gig in December needs a jacket.
- **Most monuments close by 5–6 pm**, but the night-lighting at Amer and Nahargarh runs later and is worth seeing.

## Plan your weekend

The calendar changes every week. See [what is on in Jaipur](/events?city=jaipur) and book before the good ones go.

Running an event in the city yourself? [List it on Tixit](/list-your-show) and reach people already searching for something to do this weekend.
$md$,
  'city-guides',
  'https://images.unsplash.com/photo-1477587458883-47145ed94245?w=1200&q=80',
  'Hawa Mahal in Jaipur lit up at dusk',
  true,
  ARRAY['jaipur', 'weekend', 'things to do', 'rajasthan', 'city guide'],
  'Things to Do in Jaipur This Weekend (2026 Local Guide)',
  'A local guide to Jaipur this weekend — live music, comedy nights, heritage walks, workshops and food trails, with real prices and what to book in advance.',
  'things to do in jaipur this weekend',
  $json$[
    {"question": "What is there to do in Jaipur this weekend?", "answer": "Jaipur runs live music and comedy on Friday and Saturday evenings, heritage and photography walks on weekend mornings, and craft workshops such as block printing and blue pottery through the afternoon. Ticketed shows are listed on Tixit under Jaipur, and free events run most weekends."},
    {"question": "How much does a weekend in Jaipur cost?", "answer": "A low-cost weekend using parks, bazaars and free events runs roughly 500 to 1,000 rupees per person. A standard weekend with one ticketed show, a workshop and good meals is around 2,500 to 4,000 rupees. A full weekend with a concert, heritage walk and brunches is 5,000 to 8,000 rupees."},
    {"question": "What is the best time of year to visit Jaipur?", "answer": "October to March has the most comfortable weather and the busiest events calendar. April to June is very hot but hotels are cheap and monuments are empty. July to September brings the monsoon, Teej and a green Aravalli landscape."},
    {"question": "Do I need to book Jaipur events in advance?", "answer": "For comedy shows, touring music acts and guided heritage walks, yes — these regularly sell out and door prices are usually higher than advance prices. Markets, parks and most free events need no booking."}
  ]$json$,
  '2026-01-14 09:30:00+05:30'
),

-- ── 2. Live music venues in Jaipur ──────────────────────────────────────────
(
  'Where to Find Live Music in Jaipur: Venues, Nights and What It Costs',
  'live-music-venues-in-jaipur',
  'Jaipur''s live music scene runs on rooftops, courtyards and a handful of committed venues. Here is what kind of night each one gives you, what you will pay, and how to catch the good shows before they sell out.',
  $md$
For a city its size, Jaipur has an unusually healthy live music scene — but it is not a scene you find by walking around. Most of it happens on terraces, in hotel courtyards and in venues that programme music two or three nights a week rather than every night. If you do not know where to look, you will conclude nothing is happening. It is.

Here is how the city actually works, by venue type.

## Rooftop and terrace venues

This is Jaipur's signature format, and it is the one most worth planning around. Terraces across the city — particularly around the old city and the C-Scheme area — run acoustic and semi-acoustic sets through the season.

**What you get:** a small crowd, usually 60 to 150 people, a duo or a four-piece, and a view. Sound quality varies enormously; the good ones have invested in a proper PA, the rest are running a vocalist through a monitor.

**What it costs:** ₹300 to ₹800, very often as a cover charge redeemable against your bill. That structure matters — a ₹500 cover that comes back as food and drink is effectively a free show with a minimum spend.

**When:** Friday and Saturday, occasionally Sunday evening. The season runs roughly October to March; terraces mostly stop programming through peak summer.

## Hotel and heritage venues

The larger hotels and heritage properties run the more polished end of the scene — classical Rajasthani performances, ghazal evenings, jazz brunches and the occasional booked touring act.

**What you get:** reliable sound, a seated audience, and a longer set. The classical and folk programming here is genuinely good and is the easiest place in the city to hear Rajasthani folk played properly rather than as background music.

**What it costs:** ₹800 to ₹2,500, often bundled with dinner. Jazz and classical brunches sit at the higher end.

**When:** most run a weekly or fortnightly night. Worth checking the schedule rather than turning up.

## Jawahar Kala Kendra and the institutional venues

Jawahar Kala Kendra is the most important cultural venue in the city and the least commercially promoted. It programmes concerts, classical recitals, theatre and festivals through the year, and tickets are often free or nominally priced.

**What you get:** proper auditorium seating, serious programming, and an audience that is there to listen.

**What it costs:** free to ₹500 for most events. Festival programming can be higher.

**When:** through the year, including summer, since it is indoors.

## Cafés and independent spaces

A handful of cafés and co-working spaces run open mics and singer-songwriter nights. This is where the city's newer musicians play, and it is the cheapest live music in Jaipur.

**What you get:** an open-mic format, variable quality, and occasionally something genuinely good. Low commitment.

**What it costs:** free entry to ₹300, usually with a minimum order.

**When:** midweek as often as weekends — open mics tend to land on Wednesday or Thursday.

## Club nights and DJ sets

The club end of the city runs booked DJs on Friday and Saturday, mostly commercial and Bollywood sets with the occasional techno or house night from a visiting artist.

**What it costs:** ₹500 to ₹1,500 entry, higher for a named touring DJ, and couple-entry policies are common — worth checking before you plan a night out with a group.

## Festivals and one-off dates

The genuinely large shows in Jaipur are seasonal rather than regular:

- **Literature festival season** (January) brings a music programme alongside it, often free.
- **Winter festival dates** — the October-to-February window is when touring acts route through Jaipur.
- **Teej and Gangaur** bring folk programming across the city, much of it public and free.

These are the dates that sell out fastest, and the ones where advance booking genuinely matters.

## How to actually catch the good shows

The structural problem with Jaipur's scene is discovery. Announcements go out on venue Instagram accounts a week or two ahead, and if you are not following the right ten accounts, you miss them.

Two things that help:

1. **Check the listings rather than the venues.** [Music events in Jaipur](/events?category=music&city=jaipur) collects what is ticketed in one place.
2. **Book the moment a touring act is announced.** A Delhi or Mumbai act playing Jaipur is playing one date, in a room that holds a few hundred people. Those sell out in days, not weeks.

## What you will pay, summarised

| Format | Typical price | Book ahead? |
| --- | --- | --- |
| Café open mic | Free – ₹300 | No |
| Rooftop acoustic night | ₹300 – ₹800 | Worth it on a Saturday |
| Hotel classical / ghazal evening | ₹800 – ₹2,500 | Yes |
| Club night with booked DJ | ₹500 – ₹1,500 | Yes for a named act |
| Touring headliner | ₹1,000 – ₹3,000 | Immediately |
| Jawahar Kala Kendra programming | Free – ₹500 | Usually yes, capacity is limited |

## A note for musicians and promoters

Jaipur is under-served relative to its audience. The city has more people willing to pay for a good night out than it has nights being programmed, and the venues that have committed to a regular music night have generally found an audience for it.

If you are putting on a show here, the two things that decide whether it fills are lead time and a booking link that works on a phone. [List your event on Tixit](/list-your-show) and it appears in front of people already searching for live music in the city — with QR tickets, so the door is a scan rather than a guest list argument.

## Plan a night out

See [what is on in Jaipur](/events?city=jaipur), or browse [music](/events?category=music) across every city.
$md$,
  'city-guides',
  'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&q=80',
  'A live band performing to a crowd at an indoor music venue',
  false,
  ARRAY['jaipur', 'live music', 'concerts', 'nightlife', 'venues'],
  'Live Music in Jaipur: Best Venues, Nights & Ticket Prices',
  'Where to find live music in Jaipur — rooftop gigs, hotel classical evenings, open mics, club nights and touring acts, with real ticket prices and booking advice.',
  'live music venues in jaipur',
  $json$[
    {"question": "Where can I listen to live music in Jaipur?", "answer": "Jaipur's live music runs mainly across rooftop and terrace venues, hotel and heritage properties for classical and ghazal evenings, Jawahar Kala Kendra for concerts and recitals, and cafés running open mics. Ticketed shows are listed on Tixit under music events in Jaipur."},
    {"question": "How much do live music tickets cost in Jaipur?", "answer": "A café open mic is free to 300 rupees, a rooftop acoustic night is 300 to 800 rupees, a hotel classical or ghazal evening is 800 to 2,500 rupees, and a touring headliner is 1,000 to 3,000 rupees. Jawahar Kala Kendra programming is often free or under 500 rupees."},
    {"question": "What nights does live music happen in Jaipur?", "answer": "Rooftop and club programming runs Friday and Saturday. Café open mics often fall midweek, on Wednesday or Thursday. Hotel venues typically run a weekly or fortnightly night. The season is busiest from October to March."},
    {"question": "Do I need to book live music tickets in Jaipur in advance?", "answer": "For touring acts and named DJs, yes — Jaipur usually gets a single date in a room holding a few hundred people, and those sell out within days of announcement. Open mics and most café nights need no booking."}
  ]$json$,
  '2026-01-28 11:00:00+05:30'
),

-- ── 3. How to sell event tickets online in India ────────────────────────────
(
  'How to Sell Event Tickets Online in India: The Complete 2026 Guide',
  'how-to-sell-event-tickets-online-in-india',
  'From setting up your listing to settling the money afterwards — a practical, end-to-end guide to selling tickets online in India, including payment gateways, GST, refund policy and door operations.',
  $md$
Selling tickets online is not the hard part. Selling out is. But the mechanics still trip up first-time organizers constantly — the wrong pricing structure, a refund policy written after the first refund request, a door that takes forty minutes to clear because someone is checking names against a printed list.

This guide covers the whole path, in the order you will actually hit it.

## 1. Decide what you are selling before you decide how

The single most common mistake is opening a ticketing account before deciding on the ticket structure. Work out these four things first:

- **Capacity.** The real number the venue will let in, not the number on the brochure.
- **Tiers.** Are you selling one kind of ticket, or several?
- **Price points.** Covered in detail in [our pricing guide](/blog/how-to-price-event-tickets).
- **The sale window.** When each tier goes on sale and when it stops.

Everything downstream depends on these. Changing the tier structure after tickets are live is possible but messy — people who bought at one price will notice when the structure changes.

## 2. Choose how you sell

You have three broad options in India.

**A ticketing platform.** You list the event, the platform handles payments, ticket delivery, and the payment gateway relationship. You pay a commission per ticket. This is the default for a reason: you are not building a payment integration for a one-night event, and you are not liable for the gateway compliance.

**Your own website plus a payment gateway.** Full control, no per-ticket commission beyond gateway charges, but you own everything — payment integration, ticket generation, delivery, refund handling, reconciliation, and the entry system on the night.

**Direct payments — UPI to a personal number, cash at the door.** Zero setup, and it works for a fifty-person event among people who know you. It stops working the moment strangers are buying, because you have no way of proving who paid, no way of preventing double entry, and no clean record for accounting.

For anything ticketed and public, use a platform.

## 3. Set up the listing so it actually converts

A listing is a landing page. Treat it like one.

**Title.** Say what it is and where. "Saturday Night Live Music" tells a search engine nothing. "Anhad Live in Jaipur — Rooftop Acoustic Night" tells it everything.

**The first two lines matter most.** They become the search snippet and the WhatsApp preview. Front-load the specifics: who is playing, where, when.

**Images.** One strong horizontal banner, ideally 1200×630 or wider. This is the image that appears when the link is shared, and a shared link with a good image gets meaningfully more clicks than one without.

**Venue detail, in full.** Address, landmark, and a map pin. "Near the circle" causes calls on the night.

**Terms, up front.** Age restrictions, entry cut-off, re-entry policy, what is not allowed in. Every one of these that is not on the listing becomes an argument at the gate.

## 4. Payments: what you actually need

In India, taking online card and UPI payments means a payment gateway, and a gateway means KYC.

**What a gateway will ask for:**

- PAN of the business or the individual
- Bank account and a cancelled cheque or statement
- GST registration, if you have one
- Business proof — incorporation certificate, partnership deed, or Udyam registration for a sole proprietorship
- Address proof

Allow a week for this. First-time organizers routinely leave gateway onboarding until the week they want to go live and lose selling days to it.

**Payment methods to support.** UPI is the majority of transactions for Indian event tickets — it should be first and most prominent. Cards and net banking cover the rest. Wallets are increasingly optional.

**Settlement timing.** Gateways typically settle T+2 to T+7 business days. This matters more than it sounds: if you are counting on ticket revenue to pay the venue advance, check the settlement schedule before you promise anyone anything.

**When you use a platform**, all of this sits with the platform, and you receive a payout net of commission. That is most of what you are paying the commission for.

## 5. GST and invoicing

Two separate questions, and organizers conflate them.

**Do you need to register for GST?** If your aggregate annual turnover crosses the threshold for services, yes. Inter-state supply and certain event categories can also trigger registration independent of turnover. This depends on your specific situation.

**What rate applies to admission?** Rates for admission to entertainment events depend on the category of event and, for several categories, on the ticket price — with a lower-value exemption applying to some kinds of performance. Cinema tickets sit on a different slab structure again.

**Both of these change, and the details matter.** Confirm your registration requirement and the applicable rate with a chartered accountant before you set prices — not after, because the answer determines whether your advertised price is inclusive or exclusive of tax.

Practically, what you need in place before selling:

- A decision on whether the displayed price is tax-inclusive (strongly preferred — a price that grows at checkout costs you sales)
- A GSTIN on the invoice if you are registered
- A record of every transaction, which any real ticketing platform gives you as an exportable report

## 6. Write the refund policy before you sell a ticket

Not after. The first refund request will arrive within hours of going live, and whatever you say to that person becomes your policy whether you meant it to or not.

Decide and publish:

- **Are tickets refundable at all?** Many events are not, and that is a legitimate position if it is stated clearly before purchase.
- **If refundable, until when?** A common structure: full refund up to 7 days before, partial up to 48 hours, none after.
- **What happens if you cancel or reschedule?** A full refund on cancellation is the only defensible position. For a reschedule, offer the choice of carrying the ticket over or refunding.
- **Are booking fees refunded?** Usually not, and say so.

Put this on the listing, not in a document nobody opens.

## 7. Deliver tickets people cannot forge or share

A ticket is only useful if it can be verified at the door. Three levels, worst to best:

**A name on a list.** Slow, disputable, unscalable.

**A PDF or an emailed code.** Better, but a code that is only checked visually can be screenshotted and forwarded to five people, and all five will show up.

**A signed QR code, scanned and marked used.** This is the standard, and it is what solves the actual problem. The scan checks a cryptographic signature — so a fabricated code fails before it touches the database — and marks the ticket used in the same operation, so the second person presenting the same screenshot is refused.

That last property is the one that matters. Any system where checking the ticket and marking it used are two separate steps will, on a busy door, let duplicates through.

## 8. Plan the door

Entry is where events lose their reputation. Some arithmetic: a scan takes about five seconds when it works. Five hundred guests through one scanning point is forty minutes of queue if everyone arrives at once — and they do, in the fifteen minutes before the headline act.

- **One scanning point per 150–200 expected guests** in the peak arrival window.
- **Charge every phone**, and bring power banks. A dead scanner is a stopped queue.
- **Have an offline fallback.** Venue wifi fails. A system that can accept a manually typed code, or that queues scans and syncs later, saves the night.
- **Brief the staff on the refusal script.** They will meet forged screenshots and genuinely confused guests, and the difference between a polite process and an argument is entirely preparation.

## 9. After the event

- **Reconcile.** Tickets sold against tickets scanned against money settled. Discrepancies are much easier to chase in the same week.
- **Export the data.** Attendee list, sales by tier, sales by day. This is what tells you whether early-bird pricing worked and when your sales actually happened.
- **Collect feedback while it is fresh** — within 24 hours, or the response rate falls off a cliff.
- **Keep the list.** The single most valuable asset a repeat organizer has is a list of people who have already paid to see something they put on. Your second event is far cheaper to sell than your first, but only if you kept the list from the first.

## The realistic timeline

| When | What |
| --- | --- |
| 8+ weeks out | Venue confirmed, date locked, gateway or platform KYC started |
| 6 weeks out | Listing live, early-bird tier on sale, refund policy published |
| 4 weeks out | Announcement push, early-bird closes |
| 2 weeks out | Regular tier push, paid promotion if you are running it |
| 1 week out | Reminder to everyone who viewed and did not buy |
| 48 hours out | Final push, door logistics confirmed, staff briefed |
| Day of | Scanners charged, offline fallback tested |
| Day after | Reconcile, export, thank the list |

## Start selling

[List your event on Tixit](/list-your-show) — UPI and card payments, signed QR tickets, a scanner app for the door, and CSV exports for reconciliation, with no setup cost.

Next: [how to price your tickets](/blog/how-to-price-event-tickets) and [how to promote an event in India](/blog/how-to-promote-an-event-in-india).
$md$,
  'for-organizers',
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&q=80',
  'An event organizer addressing a seated audience at a conference',
  true,
  ARRAY['organizers', 'ticketing', 'payments', 'gst', 'event management'],
  'How to Sell Event Tickets Online in India (2026 Guide)',
  'A complete guide to selling event tickets online in India — platforms vs gateways, KYC, GST, refund policy, QR ticket delivery, door operations and settlement.',
  'sell event tickets online india',
  $json$[
    {"question": "How do I sell event tickets online in India?", "answer": "Decide your capacity, tiers and prices first, then either list on a ticketing platform or run your own site with a payment gateway. A platform handles payments, ticket delivery and gateway compliance for a commission per ticket, which is the practical choice for most organizers."},
    {"question": "What documents does a payment gateway need in India?", "answer": "Typically PAN of the business or individual, a bank account with a cancelled cheque or statement, GST registration if applicable, business proof such as an incorporation certificate, partnership deed or Udyam registration, and address proof. Allow about a week for onboarding."},
    {"question": "Is GST applicable on event tickets in India?", "answer": "GST on admission to entertainment events depends on the event category and, for several categories, on the ticket price, with a lower-value exemption applying to some kinds of performance. Registration requirements depend on turnover and the nature of supply. Confirm both the rate and your registration requirement with a chartered accountant before setting prices."},
    {"question": "How long does it take to receive money from online ticket sales?", "answer": "Payment gateways typically settle T+2 to T+7 business days. Ticketing platforms pay out on their own schedule, net of commission. Check the settlement timeline before committing ticket revenue to a venue advance."},
    {"question": "How do I stop people sharing screenshots of tickets?", "answer": "Use signed QR tickets that are scanned and marked used in a single operation. The signature stops fabricated codes and the single-operation check-in means the second person presenting the same screenshot is refused entry."}
  ]$json$,
  '2026-02-04 10:00:00+05:30'
),

-- ── 4. How to price event tickets ───────────────────────────────────────────
(
  'How to Price Event Tickets: A Framework That Actually Works',
  'how-to-price-event-tickets',
  'Most organizers price by guessing what feels right, then discount in a panic. Here is a costing-first framework, the tier structures that work, and the pricing mistakes that quietly cost the most money.',
  $md$
Ticket pricing is the decision that most determines whether an event makes money, and it is routinely made in about ten minutes. The usual method is to look at what a comparable event charged, round it, and hope.

Here is a better process. It takes an hour and it will change the number.

## Step 1: Find your break-even, honestly

You cannot price sensibly until you know what the event costs. Split costs into two kinds, because they behave differently.

**Fixed costs** — what you pay regardless of how many people come:

- Venue hire
- Artist or speaker fee
- Sound, lights, staging
- Marketing spend
- Permits and licences
- Insurance
- Photography or videography

**Variable costs** — what you pay per attendee:

- Food and drink, if included
- Welcome kits, wristbands, lanyards
- Payment gateway charges and platform commission
- Any per-head venue or security charge

The break-even calculation:

```
Break-even attendance = Fixed costs ÷ (Ticket price − Variable cost per head)
```

Work this out at three candidate prices before choosing one. A worked example, for an event with ₹1,20,000 of fixed costs and ₹150 per head of variable cost:

| Ticket price | Contribution per ticket | Break-even attendance |
| --- | --- | --- |
| ₹500 | ₹350 | 343 |
| ₹800 | ₹650 | 185 |
| ₹1,200 | ₹1,050 | 115 |

If the venue holds 200, the ₹500 price is not a cheap ticket — it is an impossible one. That is the kind of thing this table surfaces in two minutes and instinct never does.

## Step 2: Sanity-check against the market

Now, and only now, look at what comparable events charge. You are checking whether your number is plausible for your city and category, not deriving it.

Rough Indian benchmarks, for orientation:

| Event type | Typical range |
| --- | --- |
| Open mic, community night | Free – ₹300 |
| Local band or comedy showcase | ₹300 – ₹800 |
| Touring comic or mid-size act | ₹800 – ₹2,000 |
| Major concert | ₹2,000 – ₹10,000+ |
| Half-day workshop | ₹800 – ₹2,500 |
| Full-day workshop or bootcamp | ₹2,500 – ₹10,000 |
| Professional conference | ₹3,000 – ₹25,000 |

These vary by city. Mumbai, Delhi and Bengaluru sustain prices that Jaipur, Indore or Kochi generally will not, for the same act.

**If your break-even price sits above the market range**, you have a cost problem, not a pricing problem. Cut fixed costs, find a sponsor, or find a bigger room. Pricing above the market and hoping is how events lose money.

## Step 3: Build the tier structure

Multiple tiers do two things: they capture more money from people willing to pay more, and they create deadlines that convert people who would otherwise decide later.

**The structure that works for most events:**

**Early bird — 20% to 30% below regular.** Its real job is not the discount. It is to generate the first sales, which is what makes an event look alive. An event with 40 tickets sold sells better than an identical event with 0, and early bird is how you buy that. Cap it — 15% to 25% of capacity — and give it a hard end date. An early bird that never sells out and never expires is just your regular price.

**Regular — your calculated price.** This should sell the bulk.

**Late or door — 15% to 25% above regular.** This rewards the people who committed early and gives the undecided a reason to stop waiting.

**VIP or premium — 1.5× to 3× regular.** Only if it genuinely delivers something: front rows, early entry, a meet-and-greet, a separate bar. A VIP tier that is just a more expensive identical ticket damages trust and does not sell.

**Group tickets.** A discount of 10% to 20% for four or more. Groups are the highest-leverage discount available, because one person makes the decision and brings three others who would not have come alone.

## Step 4: Price the psychology, not just the maths

**₹999 genuinely outperforms ₹1,000.** It is a well-documented effect and it costs you one rupee.

**Show the anchor.** A regular price displayed next to a struck-through late price makes the regular price read as a deal. This only works if the higher price is real and actually charged later.

**Round numbers for premium positioning.** ₹2,500 signals a considered price in a way ₹2,499 does not. Use charm pricing below roughly ₹1,000 and round pricing above it.

**Never surprise people at checkout.** A ₹500 ticket that becomes ₹625 with fees and tax at the payment step is the single largest source of abandoned checkouts in ticketing. Advertise the all-in price, or state the fee prominently on the listing. The trust cost of the surprise far exceeds whatever the fee earns.

## Step 5: Decide who absorbs the fees

Every online ticket carries a payment gateway charge and, on a platform, a commission. Someone pays it.

**Absorb it into the price.** Advertised ₹500 means the buyer pays ₹500 and you receive ₹500 minus charges. Cleanest for conversion, and what most consumer events should do.

**Pass it on as a visible convenience fee.** You receive the full ₹500 and the buyer pays ₹500 plus fee. Standard practice in Indian ticketing and buyers are used to it — but show it on the listing, not only at the last step.

The one option that is not available is pretending the fee does not exist until checkout.

## The mistakes that cost the most

**Pricing too low.** The most common error by a distance. A low price does not reliably fill a room — it signals low value, attracts the least committed audience, and takes the highest no-show rate. Free events routinely see 40% to 60% no-shows; paid events at a real price see 5% to 15%. Charging something, even ₹100, transforms attendance.

**Discounting in public, late.** A visible 50%-off scramble in the final week tells everyone who paid full price that they were overcharged, and teaches your audience to wait for the panic discount next time. If you must move late inventory, do it through targeted codes rather than a public price cut.

**Too many tiers.** More than four or five options creates decision paralysis. People who cannot decide do not buy the cheapest — they close the tab.

**Never revisiting the price.** If early bird sold out in six hours, your price was too low. Note it, and price the next one properly.

## Quick reference

1. List fixed and variable costs, honestly.
2. Compute break-even attendance at three candidate prices.
3. Check the candidates against market rates for your city and category.
4. Build early bird, regular and late tiers with real deadlines.
5. Cap early bird at 15–25% of capacity.
6. Charm-price below ₹1,000, round-price above.
7. Decide fee absorption and show the all-in price up front.
8. Publish the refund policy alongside the price.
9. After the event, compare tier-by-tier sales against plan.

## Put it into practice

[List your event on Tixit](/list-your-show) — set up early bird, regular, VIP, couple and group tiers with their own prices, quantities and sale windows, and watch which ones actually sell.

Next: [how to sell event tickets online in India](/blog/how-to-sell-event-tickets-online-in-india).
$md$,
  'for-organizers',
  'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1200&q=80',
  'A calculator, notebook and pen laid out for cost planning',
  false,
  ARRAY['organizers', 'pricing', 'ticketing', 'revenue', 'event management'],
  'How to Price Event Tickets: Break-Even, Tiers & Fees',
  'A costing-first framework for pricing event tickets in India — break-even maths, Indian price benchmarks, early bird and VIP tier structures, and the fee mistakes that kill conversion.',
  'how to price event tickets',
  $json$[
    {"question": "How do I calculate the right ticket price for my event?", "answer": "Separate fixed costs such as venue, artist and marketing from variable costs per attendee such as food and payment charges. Break-even attendance equals fixed costs divided by ticket price minus variable cost per head. Run that calculation at three candidate prices, then check the results against market rates for your city and category."},
    {"question": "How much should an early bird ticket be discounted?", "answer": "Twenty to thirty percent below the regular price, capped at fifteen to twenty-five percent of capacity, with a hard end date. Its main purpose is to generate visible early sales rather than to discount, so an uncapped early bird with no deadline simply becomes your regular price."},
    {"question": "Should I include booking fees in the ticket price or add them at checkout?", "answer": "Either is acceptable, but the total must be visible on the listing rather than appearing for the first time at the payment step. A price that grows at checkout is the single largest cause of abandoned ticket purchases."},
    {"question": "Is it better to make my event free or charge a small amount?", "answer": "Charging something, even a nominal amount, dramatically improves attendance. Free events typically see forty to sixty percent no-shows, while paid events at a real price see five to fifteen percent."}
  ]$json$,
  '2026-02-18 10:00:00+05:30'
),

-- ── 5. How to promote an event in India ─────────────────────────────────────
(
  'How to Promote an Event in India: 15 Tactics That Fill Rooms',
  'how-to-promote-an-event-in-india',
  'A promotion plan that works on an Indian budget — WhatsApp over email, the six-week timeline, what paid ads are actually for, and the local channels most organizers never use.',
  $md$
Most event promotion advice is written for a market where email is the primary channel and ad budgets start at four figures in dollars. Neither is true here. This is what works in India, ordered roughly by return on effort.

## First: know who you are selling to

Before any of the tactics, answer three questions in one sentence each.

1. **Who is this for?** Not "everyone". "Working professionals aged 24–34 in Jaipur who go out on Saturdays" is a description you can act on.
2. **Why would they come?** The artist, the topic, the crowd, the venue, or the fear of missing what everyone else is at.
3. **Where do they already spend time?** Instagram, WhatsApp groups, a specific Reddit or Discord community, a college campus, a co-working space.

Every tactic below works better when these are answered and fails when they are not.

## The six-week timeline

| Week | Focus |
| --- | --- |
| 6 weeks out | Announce. Early bird opens. Set up the listing and the shareable link. |
| 5 weeks out | Content push — artist or speaker introductions, venue reveal. |
| 4 weeks out | Early bird closes. Deadline urgency is real, so use it. |
| 3 weeks out | Partnerships and cross-promotion go live. Influencer and community posts. |
| 2 weeks out | Paid ads switch on, retargeting people who viewed and did not buy. |
| 1 week out | Reminder push. Testimonials or clips from past events. |
| 3 days out | "Last few tickets" — only if true. |
| Day of | Morning reminder to ticket holders with entry details. |

Announcing earlier than six weeks generally does not help. People do not plan a Saturday two months out, and an announcement they cannot act on is one they forget.

## Owned channels — do these first, they are free

### 1. WhatsApp, properly

WhatsApp is the highest-converting channel available to an Indian event organizer, and most use it badly.

**What works:** a short message with the poster image, one line on what and when, and the booking link. Sent to relevant groups, and to individuals for people who matter.

**What does not:** the same forwarded blast to twenty groups. It reads as spam and gets you removed from the groups you will need next time.

**Use Broadcast Lists** rather than groups for your own contact list — recipients see it as a direct message, and nobody can reply to all 200 people.

**A WhatsApp Business catalogue** with the event and the link makes the booking path one tap. Set the away message to the booking link during the sale period.

### 2. Instagram, as a sequence not a post

One post does not sell an event. A sequence does.

- **Announcement post** — poster, date, city, link in bio.
- **Stories, repeatedly.** Stories outperform feed posts for events because they are time-bound, which matches the product. Use the countdown sticker and the link sticker.
- **Reels.** Clips from previous editions, artist teasers, venue walkthroughs. Reels are the only reliable reach mechanism on Instagram for an account without a large following.
- **Collaborate posts** with the artist, venue and any partner. A collab post appears on both accounts' grids and pulls both audiences.
- **Behind-the-scenes** in the final week. Setup, rehearsal, the venue being prepared. This converts fence-sitters better than another poster.

### 3. The list from last time

If you have run an event before and kept the attendee list, that list is worth more than everything else here combined. These people have already paid to see something you put on.

Message them first, before the public announcement, with a code or an early window. It costs nothing, it converts several times better than cold reach, and it makes the event look sold-through early — which helps everything downstream.

### 4. Your listing page is a marketing asset

Every share of your event link puts the listing in front of someone. If the listing has a weak image, a vague title, or no venue detail, you are losing people at the last step of every other tactic on this list.

Get the title, the first two lines and the banner right. See [how to sell tickets online](/blog/how-to-sell-event-tickets-online-in-india) for the specifics.

## Earned channels — free, but they cost effort

### 5. Cross-promotion with other organizers

The organizer running a different event for a similar audience is not your competitor. Trade a mention: they post about yours, you post about theirs. Costs nothing, doubles reach.

### 6. The venue's own audience

The venue has followers, a mailing list and walk-in footfall, and most venues will promote an event they are hosting if you simply ask and hand them ready-made assets. Do not wait for them to make a poster.

### 7. Artist and speaker reach

Whoever is performing has an audience, and that audience trusts them more than it trusts you. Build the assets — a story frame, a caption, a link — and send them ready to post. Artists promote when it is one tap and often do not when it is a project.

### 8. Local communities

This is the channel most organizers skip and it is often the best one:

- **College campuses** — culture society heads and campus groups, for anything with a student audience.
- **Co-working spaces** — noticeboards, Slack channels, community managers.
- **Interest groups** — running clubs, book clubs, photography groups, standup circuits.
- **City subreddits and Discord servers** — read the self-promotion rules first, and contribute before you post.
- **Gyms, cafés and salons** — a physical poster in the right ten cafés still works for a local event.

### 9. Local press and city listings

City-focused publications, Instagram city pages and "what's on this weekend" accounts need content constantly. Send a short pitch with the date, the hook, one strong image and the link. Many will run it free. Send it two to three weeks out, not two days.

### 10. Micro-influencers over big ones

An account with 5,000 genuinely local followers will fill more seats than one with 200,000 scattered across the country. Offer passes rather than cash, be specific about what you want posted and when, and pick people whose audience is actually in your city.

## Paid channels — do these last, and only with a plan

Paid promotion is amplification, not a substitute for the above. Running ads to a weak listing wastes the budget.

### 11. Retargeting, first

The highest-return ad money is spent on people who already visited your listing and did not buy. They have demonstrated interest and are cheap to reach again. If you run only one ad campaign, run this one.

### 12. Instagram and Facebook ads for the cold audience

Meta remains the workhorse for Indian event promotion. Target by city radius and interest. Start small — ₹300 to ₹500 a day — and let it run three days before judging it. Kill creatives with a poor click-through rate rather than raising the budget on them.

Budget guidance: for a local event, ₹3,000 to ₹15,000 total is a realistic paid spend, and it should be roughly 5% to 15% of expected ticket revenue.

### 13. Google Search, for intent

Only worth it for events with real search demand — a named touring artist, or a category people search by name ("comedy show Jaipur"). For a first-time local event nobody is searching for, the search volume is not there and the money is better spent on Meta.

### 14. WhatsApp and SMS blasts

Effective and cheap, but the compliance rules on commercial messaging are real. Use a proper business messaging provider, use opt-in lists, and do not buy a database.

## 15. The last 72 hours

A disproportionate share of ticket sales happens in the final three days. Plan for it rather than being surprised by it.

- A genuine scarcity message, if it is genuine. "Last 30 tickets" when 200 remain is a lie your audience will remember.
- A final reminder to everyone who viewed and did not buy.
- Practical detail — entry time, venue, parking, what to bring. This converts people whose hesitation was logistical, not financial.
- A group offer for the undecided, who often just need someone to come with.

## What to measure

- **Views on the listing** — tells you whether promotion is working.
- **Views-to-purchase rate** — tells you whether the listing is working. Below about 5% means the problem is the page, not the traffic.
- **Sales by day** — shows which push actually moved tickets.
- **Source of each sale**, via distinct links or codes per channel. Without this you will repeat the tactics that felt busiest rather than the ones that sold.

## Get the listing right first

Every tactic here ends at your event page. [List your event on Tixit](/list-your-show) to get a shareable listing with a proper preview image, mobile checkout, UPI payments and per-day sales data so you can see which push worked.
$md$,
  'for-organizers',
  'https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=1200&q=80',
  'A crowd with raised hands at a live event',
  false,
  ARRAY['organizers', 'marketing', 'promotion', 'social media', 'event management'],
  'How to Promote an Event in India: 15 Tactics That Work',
  'A practical event promotion plan for India — WhatsApp and Instagram tactics, the six-week timeline, local community channels, and how much to spend on paid ads.',
  'how to promote an event',
  $json$[
    {"question": "How far in advance should I start promoting an event?", "answer": "About six weeks. Announce and open early bird at six weeks, close early bird at four weeks, run partnerships at three weeks, switch on paid ads at two weeks, and push reminders in the final week. Announcing much earlier rarely helps, because people do not plan a night out two months ahead."},
    {"question": "What is the best channel to promote an event in India?", "answer": "WhatsApp converts best, used as targeted messages and broadcast lists rather than mass forwards. Instagram works as a sequence of posts, stories, reels and collaboration posts rather than a single announcement. An existing attendee list from a previous event outperforms both."},
    {"question": "How much should I spend on ads to promote an event?", "answer": "Roughly five to fifteen percent of expected ticket revenue. For a local event that is typically 3,000 to 15,000 rupees in total. Spend it on retargeting people who viewed your listing first, since that is the highest-return audience, then on cold targeting by city and interest."},
    {"question": "Why are my event tickets not selling?", "answer": "Check the ratio of listing views to purchases. If views are low, the promotion is not reaching people. If views are healthy but under about five percent convert, the problem is the listing itself — usually a weak image, a vague title, missing venue detail, or a price that changes at checkout."}
  ]$json$,
  '2026-03-03 10:00:00+05:30'
),

-- ── 6. Booking tickets online safely ────────────────────────────────────────
(
  'How to Book Event Tickets Online Safely (and Avoid Fake Tickets)',
  'how-to-book-event-tickets-online-safely',
  'Fake tickets, resale scams and surprise fees are all avoidable if you know what to check. A buyer''s guide to booking online, understanding what you are charged, and what to do when something goes wrong.',
  $md$
Ticket scams work because they exploit urgency. The show is sold out, someone in a comment thread has a spare, and you have ninety seconds to decide. That pressure is the product.

Here is what to check, what the charges on your ticket actually are, and what your options are when something goes wrong.

## Buy from the source

The safest ticket is one bought from the organizer's own listing or from the ticketing platform they are using.

**How to tell you are in the right place:**

- The link came from the organizer's official account, website or verified page — not from a comment, a DM, or a forwarded message.
- The URL is spelled correctly. Scam sites clone real ones and change one character. Read the domain, slowly, before entering payment details.
- The page is `https` and the padlock is present. This is a minimum, not a guarantee — scam sites have certificates too.
- The listing names the venue, the date and the time explicitly. Vagueness is a warning sign.

## The resale problem

Most ticket fraud in India happens in resale — a sold-out show, someone offering a spare on Instagram, Telegram, OLX or a fan group.

**Why it so often goes wrong:** a ticket that is a PDF or a screenshot can be sold to five people. All five have a valid-looking ticket. One gets in.

**If you are buying resale anyway:**

- **Never pay by UPI to a personal number** for a stranger's ticket. You have no recourse.
- **Ask for the original purchase confirmation email**, with the buyer's name and booking reference visible. Forged ones exist, but it filters the lazy scams.
- **Check whether the platform supports transfers.** If it does, insist on a proper transfer rather than a forwarded file. If it does not, the ticket you are being sold cannot be legitimately transferred at all.
- **Be suspicious of a discount.** Someone selling a sold-out show below face value is not being generous.
- **Prefer meeting in person** for anything expensive.

**The warning signs, in short:** pressure to decide immediately, payment demanded to a personal UPI ID or as a "friends and family" transfer, refusal to video call or meet, a brand-new social account, a price well below face value, and communication that moves to WhatsApp or Telegram immediately.

## What you are actually charged

Ticket pricing is often less transparent than it should be. The components:

**Base price** — what the organizer set.

**Convenience or booking fee** — the platform's charge for handling payment, delivery and support. Usually a percentage of the base price. This is normal and legitimate; what is not normal is being shown it for the first time on the payment screen.

**Taxes** — GST applies to admission for many event categories, and rates depend on the category and, for some, on the ticket price.

**Payment charges** — sometimes absorbed by the platform, sometimes shown separately.

**Check the total before paying.** A good listing shows the all-in price up front. If the number changes significantly between the listing and the payment page, that is worth pausing over.

## Refunds: read this before you buy, not after

Refund policy is set by the organizer, and it varies enormously. Check it on the listing before paying.

**Common structures:**

- **Non-refundable.** Very common, and legitimate when clearly stated before purchase.
- **Tiered.** Full refund up to a week before, partial up to 48 hours, none after.
- **Fully refundable up to a cut-off.** Less common, mostly for conferences and workshops.

**Where you are usually protected regardless:**

- **If the organizer cancels**, a refund of the ticket price is the standard expectation. Booking fees are often not refunded.
- **If the event is rescheduled**, you can usually choose between carrying your ticket to the new date and requesting a refund.
- **If the event is materially different from what was advertised** — the headline act does not appear, the venue changes to somewhere much further away — you have a reasonable case.

**How long refunds take:** the platform's approval, then the payment gateway, then your bank. Five to ten business days end to end is typical. If it has been longer than that, chase it with the reference number.

## Protect yourself at the payment step

- **Never share an OTP.** No legitimate organizer, platform or bank will ever ask for it. Anyone who does is committing fraud, without exception.
- **Prefer UPI or a card on the platform's own checkout.** Both leave a disputable record.
- **Avoid direct bank transfers** to individuals for tickets.
- **Do not save card details** on sites you do not intend to use again.
- **Use the app or type the URL** rather than clicking a link in an SMS or email, particularly for a "your booking failed, click here to retry" message. That message is a common phishing pattern.

## After you book

**Check the confirmation immediately.** You should receive a confirmation with a booking reference, event details and your ticket, usually within minutes. If nothing arrives after fifteen minutes, check your spam folder, then contact support with the payment reference before booking again — double-booking is a needless refund cycle.

**Verify the details on the ticket.** Date, time, venue, quantity, tier. Mistakes are easiest to fix immediately.

**Screenshot or download the ticket.** Do not rely on venue wifi or mobile data at the gate.

**Note the entry rules.** Age restrictions, entry cut-off time, ID requirements, re-entry policy, and what you cannot bring in. Being turned away at the door for an ID you did not bring is not a refundable situation.

## At the venue

- **Arrive early** for anything popular. Entry queues at a well-attended event run 20 to 45 minutes at peak.
- **Turn your screen brightness up** before you reach the scanner — a dim screen is the most common reason a QR code will not read.
- **Carry ID** if the event is age-restricted.
- **One ticket, one entry.** A QR ticket is invalidated when it is scanned. If you bought multiple tickets, everyone needs their own code — and if someone has already used yours, you will find out at the gate, which is the point at which a resale scam becomes visible.

## If something goes wrong

1. **Contact the platform's support** with your booking reference. Most issues — a ticket that did not arrive, a wrong quantity, a payment that debited without a booking — are resolved here.
2. **If money was debited without a booking**, it is usually auto-reversed within five to seven business days. Raise it with support and with your bank if it is not.
3. **For a fraudulent transaction**, report it to your bank immediately to attempt a chargeback, and file a complaint at the national cybercrime portal, [cybercrime.gov.in](https://cybercrime.gov.in), or on the helpline 1930. Speed matters considerably for recovery.
4. **Keep everything** — screenshots of the listing, the chat, the payment reference. A complaint without evidence goes nowhere.

## The short version

- Buy from the organizer's official link or a known platform.
- Read the domain before entering payment details.
- Treat resale from strangers as high-risk, and never pay a personal UPI ID for it.
- Check the all-in total and the refund policy before paying, not after.
- Never share an OTP with anyone.
- Save the ticket offline and carry ID.

## Book with confidence

Every event on Tixit is booked through the platform, tickets are delivered instantly as signed QR codes that cannot be reused, and payments run through Razorpay with UPI, card and net banking. [Browse events](/events) and see what is on near you.
$md$,
  'ticketing-tips',
  'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=1200&q=80',
  'A person booking event tickets on a mobile phone',
  false,
  ARRAY['ticketing', 'safety', 'scams', 'refunds', 'buyer guide'],
  'How to Book Event Tickets Online Safely & Avoid Fake Tickets',
  'A buyer''s guide to booking event tickets online in India — spotting resale scams, understanding convenience fees and GST, refund rights, and what to do if you are defrauded.',
  'book event tickets online safely',
  $json$[
    {"question": "How can I tell if an event ticket is fake?", "answer": "Buy only from the organizer's official link or a known ticketing platform, and read the domain carefully before entering payment details. Treat resale from strangers as high risk: a PDF or screenshot ticket can be sold to several people, and only the first to be scanned gets in. Never pay a personal UPI ID for a stranger's ticket."},
    {"question": "What is a convenience fee on event tickets?", "answer": "It is the ticketing platform's charge for handling payment, ticket delivery and support, usually a percentage of the base ticket price. It is legitimate, but it should be visible on the listing rather than appearing for the first time on the payment screen. GST may also apply depending on the event category."},
    {"question": "Can I get a refund if an event is cancelled?", "answer": "If the organizer cancels, a refund of the ticket price is the standard expectation, though booking fees are often not refunded. If the event is rescheduled, you can usually choose between carrying your ticket to the new date or requesting a refund. Refunds typically take five to ten business days to reach your account."},
    {"question": "What should I do if I have been scammed buying event tickets?", "answer": "Contact the platform's support with your booking reference first. Report a fraudulent transaction to your bank immediately to attempt a chargeback, and file a complaint at cybercrime.gov.in or on the 1930 helpline. Keep screenshots of the listing, the conversation and the payment reference, as a complaint without evidence rarely progresses."},
    {"question": "Should I ever share an OTP to book event tickets?", "answer": "Never. No legitimate organizer, ticketing platform or bank will ask you for an OTP. Anyone who does is attempting fraud."}
  ]$json$,
  '2026-03-17 10:00:00+05:30'
)

) AS v (
  title, slug, excerpt, content, category_slug, cover_image_url, cover_image_alt,
  is_featured, tags, meta_title, meta_description, focus_keyword, faq, published_at
)
ON CONFLICT (slug) DO NOTHING;
