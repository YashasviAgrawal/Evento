-- ============================================================================
-- Event subcategories.
--
-- A second level under each category (Music → Live Music, DJ Night, …). Kept
-- in its own table rather than nesting categories, so everything that already
-- reads `categories` — the home rail, listing filters, reports — is untouched.
-- An event's subcategory is optional and must belong to the event's category;
-- the service layer enforces that pairing.
-- ============================================================================

CREATE TABLE IF NOT EXISTS subcategories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 100,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, slug)
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS subcategory_id UUID REFERENCES subcategories (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS events_subcategory_idx ON events (subcategory_id);

INSERT INTO subcategories (category_id, name, slug, display_order)
SELECT c.id, s.name, s.slug, s.ord
  FROM (VALUES
    ('music',      'Live Music',          'live-music',        1),
    ('music',      'DJ Night',            'dj-night',          2),
    ('music',      'Concert',             'concert',           3),
    ('music',      'Music Festival',      'music-festival',    4),
    ('music',      'Bollywood Night',     'bollywood-night',   5),
    ('music',      'Sufi & Ghazal',       'sufi-ghazal',       6),
    ('music',      'Classical',           'classical',         7),
    ('comedy',     'Stand-up',            'stand-up',          1),
    ('comedy',     'Open Mic',            'open-mic',          2),
    ('comedy',     'Improv',              'improv',            3),
    ('comedy',     'Poetry & Storytelling','poetry-storytelling',4),
    ('workshop',   'Art & Craft',         'art-craft',         1),
    ('workshop',   'Dance',               'dance',             2),
    ('workshop',   'Cooking',             'cooking',           3),
    ('workshop',   'Photography',         'photography',       4),
    ('workshop',   'Business & Tech',     'business-tech',     5),
    ('workshop',   'Wellness & Yoga',     'wellness-yoga',     6),
    ('sports',     'Cricket',             'cricket',           1),
    ('sports',     'Football',            'football',          2),
    ('sports',     'Marathon & Run',      'marathon-run',      3),
    ('sports',     'Fitness',             'fitness',           4),
    ('sports',     'Adventure',           'adventure',         5),
    ('theatre',    'Play',                'play',              1),
    ('theatre',    'Musical',             'musical',           2),
    ('theatre',    'Dance Performance',   'dance-performance', 3),
    ('conference', 'Tech',                'tech',              1),
    ('conference', 'Startup & Business',  'startup-business',  2),
    ('conference', 'Meetup',              'meetup',            3),
    ('nightlife',  'Club Night',          'club-night',        1),
    ('nightlife',  'DJ Night',            'dj-night',          2),
    ('nightlife',  'Garba & Dandiya',     'garba-dandiya',     3),
    ('nightlife',  'Theme Party',         'theme-party',       4),
    ('nightlife',  'New Year Party',      'new-year-party',    5),
    ('food-drink', 'Food Festival',       'food-festival',     1),
    ('food-drink', 'Tasting',             'tasting',           2),
    ('food-drink', 'Brunch',              'brunch',            3),
    ('exhibition', 'Art Exhibition',      'art-exhibition',    1),
    ('exhibition', 'Expo & Fair',         'expo-fair',         2),
    ('exhibition', 'Flea Market',         'flea-market',       3),
    ('family',     'Kids Activities',     'kids-activities',   1),
    ('family',     'Festival & Mela',     'festival-mela',     2),
    ('family',     'Garba & Dandiya',     'garba-dandiya',     3),
    ('family',     'Amusement',           'amusement',         4)
  ) AS s (category_slug, name, slug, ord)
  JOIN categories c ON c.slug = s.category_slug
ON CONFLICT (category_id, slug) DO NOTHING;
