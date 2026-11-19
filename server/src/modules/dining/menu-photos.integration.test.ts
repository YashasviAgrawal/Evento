/**
 * Digital menus, diner photos, review replies and photo moderation over HTTP.
 * Requires a seeded database.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { closePool, queryOne } from '../../db/pool';
import { MAX_PHOTOS_PER_REVIEW } from './reviews.service';

const app = createApp();
const API = '/api/v1';

// Smallest valid PNG: the upload path checks the bytes, not the label.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function signIn(email: string) {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password: 'Password123' });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.data.accessToken as string}` };
}

async function partnerRestaurant() {
  const auth = await signIn('partner@tixit.test');
  const res = await request(app).get(`${API}/partner/restaurants`).set(auth);
  const restaurant = res.body.data.find((r: { role: string }) => r.role === 'owner');
  return { auth, id: restaurant.id as string, slug: restaurant.slug as string };
}

afterAll(async () => {
  await closePool();
});

describe('digital menu', () => {
  it('lets the owner build a menu that diners can read', async () => {
    const { auth, id, slug } = await partnerRestaurant();
    const section = await request(app).post(`${API}/partner/r/${id}/menu/sections`).set(auth).send({ name: 'Test specials' });
    expect(section.status).toBe(201);

    const item = await request(app)
      .post(`${API}/partner/r/${id}/menu/items`)
      .set(auth)
      .send({ sectionId: section.body.data.id, name: 'Test thali', price: 449.5, diet: 'veg', badges: ['new'] });
    expect(item.status).toBe(201);
    expect(item.body.data).toMatchObject({ pricePaise: 44950, diet: 'veg', isAvailable: true, badges: ['new'] });

    const soldOut = await request(app)
      .patch(`${API}/partner/r/${id}/menu/items/${item.body.data.id}`)
      .set(auth)
      .send({ isAvailable: false });
    expect(soldOut.body.data.isAvailable).toBe(false);

    const publicMenu = await request(app).get(`${API}/dining/restaurants/${slug}/menu`);
    const specials = publicMenu.body.data.sections.find((s: { name: string }) => s.name === 'Test specials');
    expect(specials.items[0]).toMatchObject({ name: 'Test thali', isAvailable: false });

    await request(app).delete(`${API}/partner/r/${id}/menu/sections/${section.body.data.id}`).set(auth).expect(200);
    const gone = await queryOne('SELECT 1 FROM dining.menu_items WHERE id = $1', [item.body.data.id]);
    expect(gone).toBeNull();
  });

  it('rejects a reorder built from a stale menu', async () => {
    const { auth, id } = await partnerRestaurant();
    const menu = await request(app).get(`${API}/partner/r/${id}/menu`).set(auth);
    const ids = menu.body.data.map((s: { id: string }) => s.id);
    const stale = await request(app).post(`${API}/partner/r/${id}/menu/order`).set(auth).send({ ids: ids.slice(1) });
    expect(stale.status).toBe(400);
    expect(stale.body.error.code).toBe('STALE_ORDER');

    const reversed = await request(app).post(`${API}/partner/r/${id}/menu/order`).set(auth).send({ ids: [...ids].reverse() });
    expect(reversed.status).toBe(200);
    const after = await request(app).get(`${API}/partner/r/${id}/menu`).set(auth);
    expect(after.body.data.map((s: { id: string }) => s.id)).toEqual([...ids].reverse());
    await request(app).post(`${API}/partner/r/${id}/menu/order`).set(auth).send({ ids });
  });

  it('keeps cashiers out of the menu', async () => {
    const { id } = await partnerRestaurant();
    const cashier = await signIn('cashier@tixit.test');
    const res = await request(app).get(`${API}/partner/r/${id}/menu`).set(cashier);
    expect(res.status).toBe(403);
  });
});

describe('diner photos', () => {
  it('lets a verified diner add photos to their review, up to the limit', async () => {
    const bill = await queryOne<{ code: string; email: string }>(
      `SELECT b.code, u.email FROM dining.bill_payments b JOIN users u ON u.id = b.user_id
        WHERE b.status IN ('paid', 'verified')
          AND NOT EXISTS (SELECT 1 FROM dining.reviews rv WHERE rv.bill_payment_id = b.id)
        LIMIT 1`,
    );
    const auth = await signIn(bill!.email);
    const review = await request(app).post(`${API}/dining/reviews`).set(auth).send({ billCode: bill!.code, rating: 5 });
    expect(review.status).toBe(201);
    const reviewId = review.body.data.id as string;

    const notImage = await request(app)
      .post(`${API}/dining/reviews/${reviewId}/photos`)
      .set(auth)
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' });
    expect(notImage.status).toBe(400);

    const ids: string[] = [];
    for (let i = 0; i < MAX_PHOTOS_PER_REVIEW; i += 1) {
      const res = await request(app)
        .post(`${API}/dining/reviews/${reviewId}/photos`)
        .set(auth)
        .attach('file', PNG, { filename: 'dish.png', contentType: 'image/png' });
      expect(res.status).toBe(201);
      ids.push(res.body.data.id);
    }
    const over = await request(app)
      .post(`${API}/dining/reviews/${reviewId}/photos`)
      .set(auth)
      .attach('file', PNG, { filename: 'dish.png', contentType: 'image/png' });
    expect(over.body.error.code).toBe('PHOTO_LIMIT');

    // Someone else cannot touch them.
    const other = await signIn('admin@tixit.test');
    const steal = await request(app).delete(`${API}/dining/reviews/${reviewId}/photos/${ids[0]}`).set(other);
    expect(steal.status).toBe(404);

    // Moderation hides one, with a reason; the restaurant page stops showing it.
    const noReason = await request(app).patch(`${API}/admin/dining/photos/${ids[0]}`).set(other).send({ status: 'hidden' });
    expect(noReason.status).toBe(400);
    await request(app).patch(`${API}/admin/dining/photos/${ids[0]}`).set(other).send({ status: 'hidden', reason: 'Not of the food' }).expect(200);

    const restaurant = await queryOne<{ slug: string }>(
      'SELECT r.slug FROM dining.reviews rv JOIN dining.restaurants r ON r.id = rv.restaurant_id WHERE rv.id = $1',
      [reviewId],
    );
    const detail = await request(app).get(`${API}/dining/restaurants/${restaurant!.slug}`);
    const shown = detail.body.data.dinerPhotos.map((p: { id: string }) => p.id);
    expect(shown).not.toContain(ids[0]);
    expect(shown).toContain(ids[1]);

    for (const id of ids) await request(app).delete(`${API}/dining/reviews/${reviewId}/photos/${id}`).set(auth).expect(200);
  });
});

describe('review replies', () => {
  it('lets the restaurant answer a review publicly', async () => {
    const { auth, id, slug } = await partnerRestaurant();
    const list = await request(app).get(`${API}/partner/r/${id}/reviews`).set(auth);
    expect(list.status).toBe(200);
    const target = list.body.data.find((r: { body: string | null }) => r.body);
    await request(app)
      .put(`${API}/partner/r/${id}/reviews/${target.id}/reply`)
      .set(auth)
      .send({ reply: 'Thanks for coming in!' })
      .expect(200);
    const detail = await request(app).get(`${API}/dining/restaurants/${slug}`);
    expect(detail.body.data.reviews.find((r: { id: string }) => r.id === target.id)?.reply).toBe('Thanks for coming in!');
  });
});
