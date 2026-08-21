-- Every public listing query (home feed, /events, /catalog counts, search
-- suggestions) filters on `status = 'published' AND ends_at > now()`, and the
-- home feed's "trending" section additionally sorts by a computed score.
-- Neither was covered by an index — `events_discovery_idx` only orders on
-- starts_at — so both required a filter/sort pass over all published rows.
CREATE INDEX IF NOT EXISTS events_ends_at_idx  ON events (ends_at) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS events_trending_idx ON events (((tickets_sold * 3 + view_count)) DESC) WHERE status = 'published';
