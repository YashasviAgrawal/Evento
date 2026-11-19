/**
 * Monthly commission invoices over HTTP against a real PostgreSQL. Requires a
 * seeded database (the seed's bill history spans the previous month).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { closePool, query, queryOne } from '../../db/pool';
import { generateInvoices, monthBounds, previousMonth } from './invoices/invoice.service';
import { DINING_TZ } from './time';

const app = createApp();
const API = '/api/v1';
const month = previousMonth();

async function signIn(email: string) {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password: 'Password123' });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.data.accessToken as string}` };
}

/** Collect a response body as a Buffer (supertest buffers JSON/text only). */
function binary(res: request.Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

let ember: { id: string };
let terrace: { id: string };

beforeAll(async () => {
  ember = (await queryOne<{ id: string }>(`SELECT id FROM dining.restaurants WHERE name = 'Ember & Oak'`))!;
  terrace = (await queryOne<{ id: string }>(`SELECT id FROM dining.restaurants WHERE name = 'Terrace at Nahargarh View'`))!;
  // Make sure both restaurants earned commission last month, whatever today's date.
  const { start } = monthBounds(month);
  for (const restaurant of [ember, terrace]) {
    await query(
      `UPDATE dining.bill_payments SET paid_at = ($2::date + interval '10 days 12 hours') AT TIME ZONE $3
        WHERE id IN (SELECT id FROM dining.bill_payments WHERE restaurant_id = $1 AND status IN ('paid', 'verified')
                      ORDER BY paid_at LIMIT 2)`,
      [restaurant.id, start, DINING_TZ],
    );
  }
  await query('DELETE FROM finance.invoices WHERE period_start = $1', [start]);
});

afterAll(async () => {
  await closePool();
});

describe('commission invoices', () => {
  it('invoices an out-of-state restaurant with IGST', async () => {
    await query(`UPDATE dining.restaurants SET gstin = '27AABCT1234F1Z5', legal_name = 'Terrace Hospitality LLP' WHERE id = $1`, [terrace.id]);
    const result = await generateInvoices(month, { restaurantId: terrace.id });
    expect(result.issued).toBe(1);
    const invoice = await queryOne<{ igst_paise: number; cgst_paise: number; place_of_supply: string; recipient: { legalName: string } }>(
      'SELECT igst_paise, cgst_paise, place_of_supply, recipient FROM finance.invoices WHERE restaurant_id = $1 AND period_start = $2',
      [terrace.id, monthBounds(month).start],
    );
    expect(invoice).toMatchObject({ cgst_paise: 0, place_of_supply: '27', recipient: { legalName: 'Terrace Hospitality LLP' } });
    expect(Number(invoice!.igst_paise)).toBeGreaterThan(0);
  });

  it('issues one intra-state invoice per restaurant, matching the bills, numbered in sequence', async () => {
    const admin = await signIn('admin@tixit.test');
    const run = await request(app).post(`${API}/admin/dining/invoices/generate`).set(admin).send({ month });
    expect(run.status).toBe(200);
    expect(run.body.data.issued).toBeGreaterThanOrEqual(1);

    const again = await request(app).post(`${API}/admin/dining/invoices/generate`).set(admin).send({ month });
    expect(again.body.data.issued).toBe(0);

    const list = await request(app).get(`${API}/admin/dining/invoices`).set(admin).query({ month });
    const invoices = list.body.data.invoices as Array<{ number: string; restaurant: { id: string }; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; kind: string }>;
    const numbers = invoices.map((i) => Number(i.number.split('/')[1]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    for (const invoice of invoices) {
      expect(invoice.number).toMatch(/^TXD\d{4}\/\d{5}$/);
      expect(invoice.totalPaise).toBe(invoice.taxablePaise + invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise);
    }

    const emberInvoice = invoices.find((i) => i.restaurant.id === ember.id)!;
    const { start, end } = monthBounds(month);
    const expected = await queryOne<{ commission: number; gst: number }>(
      `SELECT sum(commission_paise)::bigint AS commission, sum(commission_gst_paise)::bigint AS gst FROM dining.bill_payments
        WHERE restaurant_id = $1 AND status IN ('paid', 'verified', 'disputed')
          AND paid_at >= ($2::date)::timestamp AT TIME ZONE $4 AND paid_at < ($3::date + 1)::timestamp AT TIME ZONE $4`,
      [ember.id, start, end, DINING_TZ],
    );
    expect(emberInvoice.taxablePaise).toBe(Number(expected!.commission));
    expect(emberInvoice.cgstPaise + emberInvoice.sgstPaise).toBe(Number(expected!.gst));
    expect(emberInvoice.igstPaise).toBe(0);
    // No supplier GSTIN configured in tests: issued honestly as a statement.
    expect(emberInvoice.kind).toBe('statement');
  });

  it('lets the owner download their own invoices, and only theirs', async () => {
    const owner = await signIn('partner@tixit.test');
    const list = await request(app).get(`${API}/partner/r/${ember.id}/invoices`).set(owner);
    expect(list.status).toBe(200);
    const invoice = list.body.data[0];
    const pdf = await request(app).get(`${API}/partner/r/${ember.id}/invoices/${invoice.id}/pdf`).set(owner).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const other = await queryOne<{ id: string }>(`SELECT id FROM finance.invoices WHERE restaurant_id <> $1 LIMIT 1`, [ember.id]);
    const leak = await request(app).get(`${API}/partner/r/${ember.id}/invoices/${other!.id}/pdf`).set(owner);
    expect(leak.status).toBe(404);

    const cashier = await signIn('cashier@tixit.test');
    expect((await request(app).get(`${API}/partner/r/${ember.id}/invoices`).set(cashier)).status).toBe(403);
  });

  it('refuses to invoice a month that has not ended', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: DINING_TZ }).slice(0, 7);
    await expect(generateInvoices(today)).rejects.toMatchObject({ code: 'MONTH_NOT_OVER' });
  });
});
