import { describe, expect, it } from 'vitest';
import { amountInWords, financialYear, splitGst, stateCodeFor } from './gst';

describe('gst helpers', () => {
  it('splits intra-state tax into CGST and SGST, inter-state into IGST', () => {
    expect(splitGst(1801, true)).toEqual({ cgst: 900, sgst: 901, igst: 0 });
    expect(splitGst(1801, false)).toEqual({ cgst: 0, sgst: 0, igst: 1801 });
  });

  it('knows the financial year runs April to March', () => {
    expect(financialYear(2026, 3)).toBe('2025-26');
    expect(financialYear(2026, 4)).toBe('2026-27');
    expect(financialYear(2099, 12)).toBe('2099-00');
  });

  it('writes amounts in Indian words', () => {
    expect(amountInWords(123_456_789)).toBe('Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Eighty Nine Paise Only');
    expect(amountInWords(10_000_000_000)).toBe('Rupees Ten Crore Only');
    expect(amountInWords(100)).toBe('Rupees One Only');
  });

  it('maps states to GST codes', () => {
    expect(stateCodeFor('Rajasthan')).toBe('08');
    expect(stateCodeFor('Maharashtra')).toBe('27');
  });
});
