import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../../db/pool';
import { BadRequestError, NotFoundError } from '../../../utils/errors';

/**
 * Digital menus. Prices are entered in rupees and stored in paise like every
 * other amount; the composite foreign keys in 0025 keep every item inside its
 * own restaurant, so the scoping here is belt and braces.
 */

export const DIETS = ['veg', 'non_veg', 'egg', 'vegan'] as const;
export const BADGES = ['bestseller', 'chef_special', 'new', 'signature'] as const;

export const sectionInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).nullish(),
});
export type SectionInput = z.infer<typeof sectionInput>;

export const itemInput = z.object({
  sectionId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullish(),
  price: z.coerce.number().min(0).max(100_000),
  diet: z.enum(DIETS),
  spiceLevel: z.coerce.number().int().min(0).max(3).default(0),
  badges: z.array(z.enum(BADGES)).max(4).default([]),
  imageUrl: z.string().url().max(500).nullish(),
  isAvailable: z.boolean().default(true),
});
export type ItemInput = z.infer<typeof itemInput>;
export const itemPatch = itemInput.partial();
export type ItemPatch = z.infer<typeof itemPatch>;

export interface MenuItem {
  id: string;
  sectionId: string;
  name: string;
  description: string | null;
  pricePaise: number;
  diet: (typeof DIETS)[number];
  spiceLevel: number;
  badges: (typeof BADGES)[number][];
  imageUrl: string | null;
  isAvailable: boolean;
}
export interface MenuSection {
  id: string;
  name: string;
  description: string | null;
  items: MenuItem[];
}

interface ItemRow {
  id: string;
  section_id: string;
  name: string;
  description: string | null;
  price_paise: string;
  diet: MenuItem['diet'];
  spice_level: number;
  badges: MenuItem['badges'];
  image_url: string | null;
  is_available: boolean;
}

const ITEM_COLUMNS = 'id, section_id, name, description, price_paise, diet, spice_level, badges, image_url, is_available';

function toItem(row: ItemRow): MenuItem {
  return {
    id: row.id,
    sectionId: row.section_id,
    name: row.name,
    description: row.description,
    pricePaise: Number(row.price_paise),
    diet: row.diet,
    spiceLevel: row.spice_level,
    badges: row.badges,
    imageUrl: row.image_url,
    isAvailable: row.is_available,
  };
}

/**
 * The whole menu in two queries. Diners see every section that has at least
 * one item (sold-out dishes stay visible, marked, so the menu reads honestly);
 * the partner view also includes empty sections.
 */
export async function getMenu(restaurantId: string, audience: 'public' | 'partner'): Promise<MenuSection[]> {
  const [sections, items] = await Promise.all([
    query<{ id: string; name: string; description: string | null }>(
      'SELECT id, name, description FROM dining.menu_sections WHERE restaurant_id = $1 ORDER BY sort, created_at',
      [restaurantId],
    ),
    query<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM dining.menu_items WHERE restaurant_id = $1 ORDER BY sort, created_at`,
      [restaurantId],
    ),
  ]);
  const bySection = new Map<string, MenuItem[]>();
  for (const row of items.rows) {
    const list = bySection.get(row.section_id) ?? [];
    list.push(toItem(row));
    bySection.set(row.section_id, list);
  }
  return sections.rows
    .map((section) => ({ ...section, items: bySection.get(section.id) ?? [] }))
    .filter((section) => audience === 'partner' || section.items.length > 0);
}

export async function getPublicMenu(slug: string): Promise<{ sections: MenuSection[]; itemCount: number }> {
  const restaurant = await queryOne<{ id: string }>(
    `SELECT id FROM dining.restaurants WHERE slug = $1 AND status IN ('live', 'paused')`,
    [slug],
  );
  if (!restaurant) throw new NotFoundError('Restaurant');
  const sections = await getMenu(restaurant.id, 'public');
  return { sections, itemCount: sections.reduce((sum, section) => sum + section.items.length, 0) };
}

/* ─────────────── sections ─────────────── */

export async function createSection(restaurantId: string, input: SectionInput) {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO dining.menu_sections (restaurant_id, name, description, sort)
     VALUES ($1, $2, $3, COALESCE((SELECT max(sort) + 1 FROM dining.menu_sections WHERE restaurant_id = $1), 0))
     RETURNING id`,
    [restaurantId, input.name, input.description ?? null],
  );
  return { id: row!.id };
}

export async function updateSection(restaurantId: string, sectionId: string, input: SectionInput) {
  const row = await queryOne(
    `UPDATE dining.menu_sections SET name = $3, description = $4, updated_at = now()
      WHERE id = $1 AND restaurant_id = $2 RETURNING id`,
    [sectionId, restaurantId, input.name, input.description ?? null],
  );
  if (!row) throw new NotFoundError('Menu section');
}

/** Deleting a section takes its items with it (the UI says so before asking). */
export async function deleteSection(restaurantId: string, sectionId: string) {
  const row = await queryOne('DELETE FROM dining.menu_sections WHERE id = $1 AND restaurant_id = $2 RETURNING id', [
    sectionId,
    restaurantId,
  ]);
  if (!row) throw new NotFoundError('Menu section');
}

/**
 * Reorder sections, or the items of one section. The ids must be exactly the
 * current set — a stale client cannot silently drop or invent rows.
 */
export async function reorder(restaurantId: string, input: { sectionId?: string | null; ids: string[] }) {
  await withTransaction(async (client) => {
    const table = input.sectionId ? 'dining.menu_items' : 'dining.menu_sections';
    const scope = input.sectionId ? 'restaurant_id = $1 AND section_id = $2' : 'restaurant_id = $1';
    const params = input.sectionId ? [restaurantId, input.sectionId] : [restaurantId];
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM ${table} WHERE ${scope} FOR UPDATE`, params);
    const current = new Set(rows.map((row) => row.id));
    if (current.size !== input.ids.length || !input.ids.every((id) => current.has(id))) {
      throw new BadRequestError('The menu changed while you were editing — reload and try again', 'STALE_ORDER');
    }
    await client.query(
      `UPDATE ${table} t SET sort = o.ord - 1, updated_at = now()
         FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, ord)
        WHERE t.id = o.id`,
      [input.ids],
    );
  });
}

/* ─────────────── items ─────────────── */

async function assertSection(restaurantId: string, sectionId: string) {
  const row = await queryOne('SELECT 1 FROM dining.menu_sections WHERE id = $1 AND restaurant_id = $2', [sectionId, restaurantId]);
  if (!row) throw new NotFoundError('Menu section');
}

export async function createItem(restaurantId: string, input: ItemInput): Promise<MenuItem> {
  await assertSection(restaurantId, input.sectionId);
  const row = await queryOne<ItemRow>(
    `INSERT INTO dining.menu_items
       (restaurant_id, section_id, name, description, price_paise, diet, spice_level, badges, image_url, is_available, sort)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             COALESCE((SELECT max(sort) + 1 FROM dining.menu_items WHERE section_id = $2), 0))
     RETURNING ${ITEM_COLUMNS}`,
    [
      restaurantId,
      input.sectionId,
      input.name,
      input.description ?? null,
      Math.round(input.price * 100),
      input.diet,
      input.spiceLevel,
      input.badges,
      input.imageUrl ?? null,
      input.isAvailable,
    ],
  );
  return toItem(row!);
}

export async function updateItem(restaurantId: string, itemId: string, patch: ItemPatch): Promise<MenuItem> {
  if (patch.sectionId) await assertSection(restaurantId, patch.sectionId);
  const columns: Record<string, unknown> = {
    section_id: patch.sectionId,
    name: patch.name,
    description: patch.description === undefined ? undefined : patch.description ?? null,
    price_paise: patch.price === undefined ? undefined : Math.round(patch.price * 100),
    diet: patch.diet,
    spice_level: patch.spiceLevel,
    badges: patch.badges,
    image_url: patch.imageUrl === undefined ? undefined : patch.imageUrl ?? null,
    is_available: patch.isAvailable,
  };
  const entries = Object.entries(columns).filter(([, value]) => value !== undefined);
  const sets = entries.map(([column], i) => `${column} = $${i + 3}`);
  const row = await queryOne<ItemRow>(
    `UPDATE dining.menu_items SET ${[...sets, 'updated_at = now()'].join(', ')}
      WHERE id = $1 AND restaurant_id = $2 RETURNING ${ITEM_COLUMNS}`,
    [itemId, restaurantId, ...entries.map(([, value]) => value)],
  );
  if (!row) throw new NotFoundError('Menu item');
  return toItem(row);
}

export async function deleteItem(restaurantId: string, itemId: string) {
  const row = await queryOne('DELETE FROM dining.menu_items WHERE id = $1 AND restaurant_id = $2 RETURNING id', [itemId, restaurantId]);
  if (!row) throw new NotFoundError('Menu item');
}
