import PDFDocument from 'pdfkit';
import { formatEventDate } from '../../utils/dates';
import { formatINR } from '../../utils/money';
import type { TicketView } from './ticket.service';

/**
 * Render a booking's tickets as a printable PDF — the PRD's "Download Ticket".
 * One page per ticket, each with its own scannable QR.
 */
export function renderTicketsPdf(
  tickets: TicketView[],
  booking: { bookingCode: string; customerName: string; totalPaise: number },
): NodeJS.ReadableStream {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Tixit ticket ${booking.bookingCode}` } });

  const BRAND = '#e11d48';
  const INK = '#18181b';
  const MUTED = '#71717a';
  const PAGE_WIDTH = 595.28;

  tickets.forEach((ticket, index) => {
    if (index > 0) doc.addPage();

    // Header band
    doc.rect(0, 0, PAGE_WIDTH, 90).fill(BRAND);
    doc.fillColor('#ffffff').fontSize(26).font('Helvetica-Bold').text('Tixit', 48, 30);
    doc.fontSize(10).font('Helvetica').text('E-TICKET', PAGE_WIDTH - 148, 38, { width: 100, align: 'right' });

    let y = 130;

    doc.fillColor(INK).fontSize(22).font('Helvetica-Bold').text(ticket.event.title, 48, y, { width: 500 });
    y = doc.y + 14;

    const rows: Array<[string, string]> = [
      ['Booking ID', ticket.bookingCode],
      ['Ticket Code', ticket.ticketCode],
      ['Attendee', ticket.attendeeName],
      ['Ticket Type', ticket.ticketTypeName],
      ['Date & Time', formatEventDate(ticket.event.startsAt, ticket.event.timezone)],
      ['Venue', `${ticket.event.venueName}, ${ticket.event.addressLine1}`],
      ['City', ticket.event.cityName],
      ['Status', ticket.status.toUpperCase()],
    ];

    for (const [label, value] of rows) {
      doc.fontSize(9).font('Helvetica').fillColor(MUTED).text(label.toUpperCase(), 48, y);
      doc.fontSize(12).font('Helvetica-Bold').fillColor(INK).text(value, 48, y + 12, { width: 300 });
      y += 40;
    }

    // QR block, right-aligned against the detail column
    const qrBase64 = ticket.qrDataUrl.split(',')[1];
    if (qrBase64) {
      const qrSize = 150;
      const qrX = PAGE_WIDTH - qrSize - 48;
      doc.image(Buffer.from(qrBase64, 'base64'), qrX, 150, { width: qrSize, height: qrSize });
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor(MUTED)
        .text('Scan at the venue entrance', qrX, 150 + qrSize + 8, { width: qrSize, align: 'center' });
    }

    // Perforation line, then the terms strip
    y = Math.max(y, 470);
    doc.moveTo(48, y).lineTo(PAGE_WIDTH - 48, y).dash(4, { space: 4 }).strokeColor('#d4d4d8').stroke().undash();

    y += 22;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text('Terms & Conditions', 48, y);
    y += 16;
    const terms = [
      'This ticket is valid for a single entry and must be presented at the venue.',
      'Carry a government-issued photo ID matching the attendee name.',
      'The QR code is unique — do not share screenshots of this ticket.',
      'Entry may be refused for late arrival or breach of venue rules.',
      'Refunds are governed by the organizer’s cancellation policy.',
    ];
    doc.fontSize(9).font('Helvetica').fillColor(MUTED);
    for (const term of terms) {
      doc.text(`•  ${term}`, 48, y, { width: PAGE_WIDTH - 96 });
      y = doc.y + 4;
    }

    // Footer
    doc
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        `Ticket ${index + 1} of ${tickets.length}  ·  Order total ${formatINR(booking.totalPaise)}  ·  Booked by ${booking.customerName}`,
        48,
        780,
        { width: PAGE_WIDTH - 96, align: 'center' },
      );
  });

  doc.end();
  return doc;
}
