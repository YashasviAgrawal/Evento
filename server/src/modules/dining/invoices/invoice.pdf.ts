import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { amountInWords } from '../../../utils/gst';
import type { Invoice, InvoiceParty } from './invoice.service';

/**
 * A4 commission invoice. Core PDF fonts have no ₹ glyph, so amounts are in
 * "INR" columns — the convention on Indian tax invoices anyway.
 */
const BRAND = '#e11d48';
const INK = '#18181b';
const MUTED = '#71717a';
const RULE = '#e4e4e7';
const LEFT = 48;
const RIGHT = 547;
const WIDTH = RIGHT - LEFT;

function inr(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function longDate(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(`${iso}T00:00:00+05:30`) : iso;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function party(doc: PDFKit.PDFDocument, title: string, p: InvoiceParty, x: number, y: number, width: number): number {
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(title.toUpperCase(), x, y, { width, characterSpacing: 0.6 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(p.legalName, x, y + 13, { width });
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(p.address, x, doc.y + 2, { width });
  doc.text(`GSTIN: ${p.gstin ?? 'Unregistered'}`, x, doc.y + 2, { width });
  doc.text(`State: ${p.stateName} (${p.stateCode})`, x, doc.y + 1, { width });
  return doc.y;
}

export function renderInvoicePdf(invoice: Invoice): NodeJS.ReadableStream {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Tixit ${invoice.number}`, Author: invoice.supplier.legalName } });
  const tax = invoice.kind === 'tax_invoice';

  // Header band
  doc.rect(0, 0, 595.28, 84).fill(BRAND);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text('Tixit', LEFT, 28);
  doc.font('Helvetica-Bold').fontSize(13).text(tax ? 'TAX INVOICE' : 'COMMISSION STATEMENT', LEFT, 26, { width: WIDTH, align: 'right' });
  doc.font('Helvetica').fontSize(9).text(tax ? 'Original for recipient' : 'Not a tax invoice — supplier GSTIN not configured', LEFT, 46, {
    width: WIDTH,
    align: 'right',
  });

  // Meta
  let y = 108;
  const meta: Array<[string, string]> = [
    [tax ? 'Invoice no.' : 'Statement no.', invoice.number],
    ['Date', longDate(invoice.issuedAt)],
    ['Period', `${longDate(invoice.periodStart)} – ${longDate(invoice.periodEnd)}`],
    ['Place of supply', `${invoice.recipient.stateName} (${invoice.placeOfSupply})`],
  ];
  meta.forEach(([label, value], i) => {
    const x = LEFT + (i % 2) * (WIDTH / 2);
    const row = y + Math.floor(i / 2) * 30;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label.toUpperCase(), x, row, { characterSpacing: 0.6 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(value, x, row + 11);
  });
  y += 72;

  // Parties
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(RULE).stroke();
  y += 14;
  const left = party(doc, 'Supplier', invoice.supplier, LEFT, y, WIDTH / 2 - 16);
  const right = party(doc, 'Bill to', invoice.recipient, LEFT + WIDTH / 2, y, WIDTH / 2);
  y = Math.max(left, right) + 20;

  // Lines table
  const cols = { desc: LEFT, qty: 300, base: 340, taxable: 420, gst: 490 };
  doc.rect(LEFT, y, WIDTH, 22).fill('#f4f4f5');
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
  doc.text('DESCRIPTION', cols.desc + 8, y + 7);
  doc.text('QTY', cols.qty, y + 7, { width: 32, align: 'right' });
  doc.text('NET SALES', cols.base, y + 7, { width: 72, align: 'right' });
  doc.text('TAXABLE', cols.taxable, y + 7, { width: 64, align: 'right' });
  doc.text('GST 18%', cols.gst, y + 7, { width: RIGHT - cols.gst - 8, align: 'right' });
  y += 30;

  for (const line of invoice.lines) {
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(line.description, cols.desc + 8, y, { width: 240 });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`SAC ${line.sac ?? invoice.sac}`, cols.desc + 8, doc.y + 1);
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(String(line.quantity), cols.qty, y, { width: 32, align: 'right' });
    doc.text(inr(line.basePaise), cols.base, y, { width: 72, align: 'right' });
    doc.text(inr(line.taxablePaise), cols.taxable, y, { width: 64, align: 'right' });
    doc.text(inr(line.gstPaise), cols.gst, y, { width: RIGHT - cols.gst - 8, align: 'right' });
    y += 36;
    doc.moveTo(LEFT, y - 8).lineTo(RIGHT, y - 8).strokeColor(RULE).stroke();
  }

  // Totals
  const totals: Array<[string, number, boolean?]> = [['Taxable value', invoice.taxablePaise]];
  if (invoice.igstPaise > 0) totals.push(['IGST @ 18%', invoice.igstPaise]);
  else {
    totals.push(['CGST @ 9%', invoice.cgstPaise]);
    totals.push(['SGST @ 9%', invoice.sgstPaise]);
  }
  totals.push(['Total (INR)', invoice.totalPaise, true]);
  y += 6;
  for (const [label, amount, bold] of totals) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(INK);
    doc.text(label, 340, y, { width: 120 });
    doc.text(inr(amount), 420, y, { width: RIGHT - 420 - 8, align: 'right' });
    y += bold ? 20 : 16;
  }
  doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(amountInWords(invoice.totalPaise), LEFT, y + 4, { width: WIDTH });

  // Footer notes
  y = doc.y + 24;
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(RULE).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    [
      'Commission has already been deducted from your payouts for the period; this document records it — nothing further is payable.',
      'Tax is not payable on reverse charge. Amounts are as frozen on each bill at payment and as posted for retained deposits.',
      'This is a computer-generated document and does not require a signature.',
    ].join('\n'),
    LEFT,
    y + 12,
    { width: WIDTH, lineGap: 3 },
  );

  doc.end();
  return doc;
}

/** Stream an invoice as a download, named by its number. */
export function sendInvoicePdf(res: Response, invoice: Invoice): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="tixit-${invoice.number.replace('/', '-')}.pdf"`);
  renderInvoicePdf(invoice).pipe(res);
}
