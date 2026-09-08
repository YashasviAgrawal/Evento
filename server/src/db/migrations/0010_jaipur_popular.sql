-- ============================================================================
-- Jaipur joins the popular cities, and leads them.
--
-- 0009 curated nine popular cities behind the home-page rail, the footer links
-- and the shortlist at the top of every city picker. Jaipur belongs on that
-- list and should sit first, so the set becomes ten and everything below it
-- shifts down one place.
--
-- The whole curated order is re-stated rather than patched so the intended
-- list stays readable in one place, and re-running is a no-op.
-- ============================================================================

UPDATE cities
   SET is_popular = slug IN (
         'jaipur','mumbai','delhi','bengaluru','hyderabad','pune','chennai','kolkata','ahmedabad','goa'
       );

UPDATE cities SET display_order = 100 WHERE is_popular = false;

UPDATE cities c
   SET display_order = o.ord
  FROM (VALUES
    ('jaipur', 1), ('mumbai', 2), ('delhi', 3), ('bengaluru', 4), ('hyderabad', 5),
    ('pune', 6), ('chennai', 7), ('kolkata', 8), ('ahmedabad', 9), ('goa', 10)
  ) AS o(slug, ord)
 WHERE c.slug = o.slug;
