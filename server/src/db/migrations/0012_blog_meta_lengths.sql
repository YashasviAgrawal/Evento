-- ============================================================================
-- Trim two over-long meta descriptions.
--
-- Google renders roughly 155–160 characters of a description before cutting it
-- off with an ellipsis. Two of the articles seeded in 0011 came in at 184 and
-- 173 characters, so the closing clause — the part carrying the reason to
-- click — was being truncated away in exactly the place it mattered.
--
-- A separate migration rather than an edit to 0011, because 0011 has already
-- been applied and the runner checksums migrations specifically to catch
-- history being rewritten underneath a deployed database.
--
-- Matched on slug and scoped by the old value, so this is idempotent and is a
-- no-op on a database created after 0011 was corrected, or where an editor has
-- since rewritten the description by hand.
-- ============================================================================

UPDATE blog_posts
   SET meta_description =
       'Price event tickets in India with a costing-first framework: break-even maths, price benchmarks, early bird and VIP tiers, and the fees that kill conversion.'
 WHERE slug = 'how-to-price-event-tickets'
   AND meta_description LIKE 'A costing-first framework for pricing event tickets%';

UPDATE blog_posts
   SET meta_description =
       'A buyer guide to booking event tickets online in India: spotting resale scams, convenience fees and GST, refund rights, and what to do if you are scammed.'
 WHERE slug = 'how-to-book-event-tickets-online-safely'
   AND meta_description LIKE '%what to do if you are defrauded.';
