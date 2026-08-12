-- ============================================================================
-- Cover images for categories.
--
-- The category rail on the home page was flat icon tiles — the plainest thing
-- on the page. `cities` already carries an image_url, so this keeps the two
-- reference tables symmetric and lets an admin swap artwork later without a
-- code change.
-- ============================================================================

ALTER TABLE categories ADD COLUMN image_url TEXT;

UPDATE categories SET image_url = CASE slug
  WHEN 'music'       THEN 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=600&q=80'
  WHEN 'comedy'      THEN 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=600&q=80'
  WHEN 'workshop'    THEN 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=600&q=80'
  WHEN 'sports'      THEN 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=600&q=80'
  WHEN 'theatre'     THEN 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=600&q=80'
  WHEN 'conference'  THEN 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=600&q=80'
  WHEN 'nightlife'   THEN 'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?w=600&q=80'
  WHEN 'food-drink'  THEN 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&q=80'
  WHEN 'exhibition'  THEN 'https://images.unsplash.com/photo-1531058020387-3be344556be6?w=600&q=80'
  WHEN 'family'      THEN 'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=600&q=80'
  ELSE image_url
END
WHERE image_url IS NULL;
