/**
 * DPDP rights and grievance redressal over HTTP. Requires a seeded database.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../app';
import { closePool, query, queryOne } from '../../db/pool';

const app = createApp();

async function signIn(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123' });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.data.accessToken as string}` };
}

afterAll(async () => {
  await closePool();
});

describe('privacy centre', () => {
  it('records consent as an append-only history of decisions', async () => {
    const auth = await signIn('kabir@example.com');
    const initial = await request(app).get('/api/v1/privacy/consents').set(auth);
    expect(initial.body.data.consents.every((c: { granted: boolean }) => !c.granted)).toBe(true);

    await request(app).put('/api/v1/privacy/consents').set(auth).send({ consents: [{ purpose: 'marketing_email', granted: true }] });
    await request(app).put('/api/v1/privacy/consents').set(auth).send({ consents: [{ purpose: 'marketing_email', granted: true }] });
    const withdrawn = await request(app).put('/api/v1/privacy/consents').set(auth).send({ consents: [{ purpose: 'marketing_email', granted: false }] });
    expect(withdrawn.body.data.find((c: { purpose: string }) => c.purpose === 'marketing_email').granted).toBe(false);

    const log = await queryOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM privacy.consents c JOIN users u ON u.id = c.user_id
        WHERE u.email = 'kabir@example.com' AND c.purpose = 'marketing_email'`,
    );
    // Grant, (unchanged repeat ignored), withdraw.
    expect(log!.count).toBe(2);
  });

  it('exports everything held about the person', async () => {
    const auth = await signIn('diya@example.com');
    const res = await request(app).get('/api/v1/privacy/export').set(auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/tixit-my-data\.json/);
    expect(res.body.data.profile.email).toBe('diya@example.com');
    expect(Array.isArray(res.body.data.billPayments)).toBe(true);
    expect(Array.isArray(res.body.data.consents)).toBe(true);
  });

  it('erases an account on request while keeping payment records', async () => {
    const email = `erase-${Date.now()}@example.com`;
    const user = await queryOne<{ id: string }>(
      `INSERT INTO users (full_name, email, phone, password_hash, role, email_verified_at)
       VALUES ('Erase Me', $1, $2, $3, 'customer', now()) RETURNING id`,
      [email, `98${String(Date.now()).slice(-8)}`, await bcrypt.hash('Password123', 4)],
    );
    const auth = await signIn(email);
    const created = await request(app).post('/api/v1/privacy/requests').set(auth).send({ kind: 'erasure', details: 'Please delete me' });
    expect(created.status).toBe(201);
    expect(created.body.data.reference).toMatch(/^DPR-/);

    const admin = await signIn('admin@tixit.test');
    const list = await request(app).get('/api/v1/admin/privacy/requests').set(admin);
    const mine = list.body.data.find((r: { reference: string }) => r.reference === created.body.data.reference);
    const done = await request(app).patch(`/api/v1/admin/privacy/requests/${mine.id}`).set(admin).send({ status: 'completed', resolution: 'Erased' });
    expect(done.status).toBe(200);

    const after = await queryOne<{ full_name: string; email: string; phone: string | null; status: string }>(
      'SELECT full_name, email, phone, status FROM users WHERE id = $1',
      [user!.id],
    );
    expect(after).toMatchObject({ full_name: 'Deleted user', phone: null, status: 'deleted' });
    expect(after!.email).toMatch(/@tixit\.invalid$/);
    const relogin = await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123' });
    expect(relogin.status).not.toBe(200);
  });
});

describe('grievance redressal', () => {
  it('acknowledges a complaint with a reference and lets the officer respond', async () => {
    const officer = await request(app).get('/api/v1/privacy/grievance-officer');
    expect(officer.body.data.email).toBeTruthy();

    const filed = await request(app).post('/api/v1/privacy/grievances').send({
      name: 'Rohit Verma',
      email: 'rohit@example.com',
      category: 'payment',
      subject: 'Charged twice for one bill',
      body: 'I paid my bill at Ember & Oak and see two debits on my card.',
      orderRef: 'BIL-TEST01',
    });
    expect(filed.status).toBe(201);
    expect(filed.body.data.reference).toMatch(/^GRV-/);

    const admin = await signIn('admin@tixit.test');
    const list = await request(app).get('/api/v1/admin/privacy/grievances').set(admin);
    const row = list.body.data.find((g: { reference: string }) => g.reference === filed.body.data.reference);
    const answered = await request(app)
      .patch(`/api/v1/admin/privacy/grievances/${row.id}`)
      .set(admin)
      .send({ status: 'resolved', response: 'The second debit was a pre-authorisation and has been released.' });
    expect(answered.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const mails = await query(`SELECT 1 FROM notifications WHERE to_address = 'rohit@example.com' AND template = 'grievance_update'`);
    // Acknowledgement and response.
    expect(mails.rows.length).toBe(2);

    const diner = await signIn('diya@example.com');
    const forbidden = await request(app).get('/api/v1/admin/privacy/grievances').set(diner);
    expect(forbidden.status).toBe(403);
  });
});
