-- ============================================================================
-- Digital menus and diner photos
--
-- Menus are sections of items, owned by one restaurant. Composite foreign keys
-- (id, restaurant_id) make it impossible for an item to sit in another
-- restaurant's section, or for a photo to point at another restaurant's
-- review, whatever the application code does.
-- ============================================================================

CREATE TABLE dining.menu_sections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description    TEXT CHECK (char_length(description) <= 200),
  sort           INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, restaurant_id)
);
CREATE INDEX menu_sections_restaurant_idx ON dining.menu_sections (restaurant_id, sort);

CREATE TABLE dining.menu_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL,
  section_id     UUID NOT NULL,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description    TEXT CHECK (char_length(description) <= 300),
  price_paise    BIGINT NOT NULL CHECK (price_paise >= 0),
  diet           TEXT NOT NULL CHECK (diet IN ('veg', 'non_veg', 'egg', 'vegan')),
  spice_level    SMALLINT NOT NULL DEFAULT 0 CHECK (spice_level BETWEEN 0 AND 3),
  -- Small closed vocabulary so badges render consistently.
  badges         TEXT[] NOT NULL DEFAULT '{}'
                   CHECK (badges <@ ARRAY['bestseller', 'chef_special', 'new', 'signature']::TEXT[]),
  image_url      TEXT,
  is_available   BOOLEAN NOT NULL DEFAULT true,
  sort           INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (section_id, restaurant_id) REFERENCES dining.menu_sections (id, restaurant_id) ON DELETE CASCADE
);
CREATE INDEX menu_items_section_idx ON dining.menu_items (section_id, sort);
CREATE INDEX menu_items_restaurant_idx ON dining.menu_items (restaurant_id);

ALTER TABLE dining.reviews
  ADD CONSTRAINT reviews_id_restaurant_key UNIQUE (id, restaurant_id),
  ADD COLUMN replied_at TIMESTAMPTZ;

CREATE TABLE dining.review_photos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id      UUID NOT NULL,
  restaurant_id  UUID NOT NULL,
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  public_id      TEXT NOT NULL,
  provider       TEXT NOT NULL CHECK (provider IN ('cloudinary', 'local')),
  -- Published on upload (the diner paid, so the visit is verified) and
  -- taken down by moderation when needed.
  status         TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  hidden_reason  TEXT,
  moderated_by   UUID REFERENCES users (id) ON DELETE SET NULL,
  moderated_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (review_id, restaurant_id) REFERENCES dining.reviews (id, restaurant_id) ON DELETE CASCADE,
  CHECK (status = 'visible' OR hidden_reason IS NOT NULL)
);
CREATE INDEX review_photos_review_idx ON dining.review_photos (review_id);
CREATE INDEX review_photos_restaurant_idx ON dining.review_photos (restaurant_id, status, created_at DESC);
