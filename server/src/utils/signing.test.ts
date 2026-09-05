import { describe, expect, it } from 'vitest';
import {
  buildQrPayload,
  normaliseTicketCode,
  parseQrPayload,
  parseTicketInput,
  safeEqual,
  signTicket,
  verifyTicketSignature,
} from './signing';
import { toCsv } from './csv';
import { generateBookingCode, generateOtp, generateTicketCode, slugify } from './ids';

describe('QR ticket signing', () => {
  const eventId = '9f8d1c4e-1111-4aaa-9bbb-000000000001';
  const otherEvent = '9f8d1c4e-2222-4aaa-9bbb-000000000002';

  it('accepts a signature it produced', () => {
    const code = 'TKT-ABCD1234';
    expect(verifyTicketSignature(code, eventId, signTicket(code, eventId))).toBe(true);
  });

  it('rejects a tampered ticket code', () => {
    const signature = signTicket('TKT-ABCD1234', eventId);
    expect(verifyTicketSignature('TKT-ABCD9999', eventId, signature)).toBe(false);
  });

  it('rejects a valid ticket replayed at a different event', () => {
    // The signature binds code *and* event, so a real ticket for event A
    // cannot be presented at event B.
    const code = 'TKT-ABCD1234';
    expect(verifyTicketSignature(code, otherEvent, signTicket(code, eventId))).toBe(false);
  });

  it('rejects a forged signature', () => {
    expect(verifyTicketSignature('TKT-ABCD1234', eventId, 'f'.repeat(32))).toBe(false);
  });

  it('round-trips the QR payload', () => {
    const payload = buildQrPayload('TKT-ABCD1234', eventId);
    const parsed = parseQrPayload(payload);

    expect(parsed).not.toBeNull();
    expect(parsed!.ticketCode).toBe('TKT-ABCD1234');
    expect(verifyTicketSignature(parsed!.ticketCode, eventId, parsed!.signature)).toBe(true);
  });

  it('refuses malformed payloads', () => {
    for (const bad of ['', 'nodot', '.leading', 'trailing.', '   ']) {
      expect(parseQrPayload(bad)).toBeNull();
    }
  });

  it('compares in constant time without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('check-in input parsing', () => {
  const eventId = '9f8d1c4e-1111-4aaa-9bbb-000000000001';

  it('reads a scanned QR payload and keeps its signature', () => {
    const parsed = parseTicketInput(buildQrPayload('TKT-ABCD2345', eventId));

    expect(parsed).toMatchObject({ ticketCode: 'TKT-ABCD2345', source: 'qr' });
    expect(verifyTicketSignature('TKT-ABCD2345', eventId, parsed!.signature!)).toBe(true);
  });

  it('accepts the bare ticket code printed on the ticket', () => {
    // The manual-entry fallback can only ever send the code — the signature is
    // not printed anywhere a person could read it.
    expect(parseTicketInput('TKT-ABCD2345')).toEqual({
      ticketCode: 'TKT-ABCD2345',
      signature: null,
      source: 'manual',
    });
  });

  it('forgives how the code was typed', () => {
    for (const typed of ['tkt-abcd2345', '  TKT-ABCD2345  ', 'TKTABCD2345', 'ABCD2345', 'TKT ABCD 2345']) {
      expect(normaliseTicketCode(typed)).toBe('TKT-ABCD2345');
    }
  });

  it('rejects input that cannot be a ticket code', () => {
    for (const bad of ['', '   ', 'TKT-', 'TKT-SHORT', 'TKT-ABCD23456', 'TKT-ABCD01IL', 'not a ticket']) {
      expect(parseTicketInput(bad)).toBeNull();
    }
  });

  it('treats a code with a non-signature suffix as manual input, not a QR', () => {
    expect(parseTicketInput('TKT-ABCD2345.')).toMatchObject({ source: 'manual', signature: null });
  });
});

describe('identifier generation', () => {
  it('emits readable booking codes with no ambiguous characters', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateBookingCode();
      expect(code).toMatch(/^EVT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
      // 0/O and 1/I/L are excluded so codes can be read aloud at a gate.
      expect(code.slice(4)).not.toMatch(/[01OIL]/);
    }
  });

  it('emits ticket codes in the expected shape', () => {
    expect(generateTicketCode()).toMatch(/^TKT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  });

  it('emits six-digit OTPs that never start with zero', () => {
    for (let i = 0; i < 200; i += 1) {
      const otp = generateOtp(6);
      expect(otp).toMatch(/^[1-9]\d{5}$/);
    }
  });

  it('slugifies titles safely', () => {
    expect(slugify('Sunburn Arena ft. Alan Walker')).toBe('sunburn-arena-ft-alan-walker');
    expect(slugify('  Café  Münchén  ')).toBe('cafe-munchen');
    expect(slugify('!!!')).toBe('');
  });
});

describe('CSV export', () => {
  it('quotes separators, quotes and newlines', () => {
    const csv = toCsv([{ name: 'Doe, Jane', note: 'She said "hi"\nthen left' }], [
      { header: 'Name', value: (row) => row.name },
      { header: 'Note', value: (row) => row.note },
    ]);

    expect(csv).toContain('"Doe, Jane"');
    expect(csv).toContain('"She said ""hi""');
  });

  it('neutralises formula injection', () => {
    // A cell starting with = would execute when opened in Excel or Sheets.
    const csv = toCsv([{ name: '=1+1' }, { name: '+CMD()' }, { name: '-2' }, { name: '@SUM(A1)' }], [
      { header: 'Name', value: (row) => row.name },
    ]);

    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+CMD()");
    expect(csv).toContain("'-2");
    expect(csv).toContain("'@SUM(A1)");
  });

  it('starts with a UTF-8 BOM so Excel honours the encoding', () => {
    const csv = toCsv([{ a: 'x' }], [{ header: 'A', value: (row) => row.a }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
});
