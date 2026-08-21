-- ============================================================================
-- Reference data the product cannot function without: the city list backing
-- "Popular Cities", the event taxonomy backing the category rail, and the
-- default platform settings the admin console edits.
--
-- Written with ON CONFLICT DO NOTHING so re-running against an existing
-- database is a no-op rather than a duplicate-key failure.
-- ============================================================================

INSERT INTO cities (name, slug, state, is_popular, display_order, image_url) VALUES
  ('Mumbai',    'mumbai',    'Maharashtra',   true,  1,  'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?w=800&q=80'),
  ('Delhi',     'delhi',     'Delhi',         true,  2,  'https://images.unsplash.com/photo-1587474260584-136574528ed5?w=800&q=80'),
  ('Bengaluru', 'bengaluru', 'Karnataka',     true,  3,  'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?w=800&q=80'),
  ('Hyderabad', 'hyderabad', 'Telangana',     true,  4,  'https://images.unsplash.com/photo-1572445271230-a78b5944a659?w=800&q=80'),
  ('Pune',      'pune',      'Maharashtra',   true,  5,  'https://images.unsplash.com/photo-1553064087-8ff5b4d1b4ac?w=800&q=80'),
  ('Chennai',   'chennai',   'Tamil Nadu',    true,  6,  'https://images.unsplash.com/photo-1582510003544-4d00b7f74220?w=800&q=80'),
  ('Kolkata',   'kolkata',   'West Bengal',   true,  7,  'https://images.unsplash.com/photo-1558431382-27e303142255?w=800&q=80'),
  ('Ahmedabad', 'ahmedabad', 'Gujarat',       true,  8,  'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=800&q=80'),
  ('Jaipur',    'jaipur',    'Rajasthan',     false, 9,  'https://images.unsplash.com/photo-1477587458883-47145ed94245?w=800&q=80'),
  ('Goa',       'goa',       'Goa',           true,  10, 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=800&q=80'),
  ('Chandigarh','chandigarh','Chandigarh',    false, 11, NULL),
  ('Lucknow',   'lucknow',   'Uttar Pradesh', false, 12, NULL),
  ('Indore',    'indore',    'Madhya Pradesh',false, 13, NULL),
  ('Kochi',     'kochi',     'Kerala',        false, 14, NULL)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (name, slug, icon, color, description, display_order) VALUES
  ('Music',       'music',       'Music',       '#e11d48', 'Concerts, gigs, festivals and live sets',        1),
  ('Comedy',      'comedy',      'Mic',         '#f59e0b', 'Stand-up, improv and open mics',                 2),
  ('Workshop',    'workshop',    'GraduationCap','#0ea5e9', 'Hands-on sessions, bootcamps and masterclasses', 3),
  ('Sports',      'sports',      'Trophy',      '#16a34a', 'Matches, tournaments, marathons and fitness',    4),
  ('Theatre',     'theatre',     'Drama',       '#a855f7', 'Plays, musicals and performance art',            5),
  ('Conference',  'conference',  'Presentation','#6366f1', 'Summits, meetups and industry conferences',      6),
  ('Nightlife',   'nightlife',   'PartyPopper', '#db2777', 'Club nights, parties and DJ sets',               7),
  ('Food & Drink','food-drink',  'UtensilsCrossed','#ea580c','Tastings, food walks and pop-ups',             8),
  ('Exhibition',  'exhibition',  'Palette',     '#0891b2', 'Art shows, expos and galleries',                 9),
  ('Family',      'family',      'Baby',        '#14b8a6', 'Kid-friendly and family outings',               10)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO settings (key, value, description) VALUES
  ('commission_percent',      '10',    'Default platform commission (%) deducted from organizer revenue'),
  ('tax_percent',             '18',    'GST (%) applied to the discounted ticket subtotal'),
  ('convenience_fee_percent', '2',     'Platform convenience fee (%) applied to the discounted subtotal'),
  ('booking_hold_minutes',    '15',    'Minutes a pending booking holds inventory before it is released'),
  ('refund_window_hours',     '48',    'Hours before event start during which a customer may request a refund'),
  ('support_email',           '"support@tixit.in"',    'Support address shown to customers'),
  ('platform_name',           '"Evento"',              'Display name used across emails and tickets'),
  ('auto_approve_events',     'false', 'When true, submitted events publish without admin review')
ON CONFLICT (key) DO NOTHING;
