import { env } from '../config/env';
import { formatINR } from '../utils/money';

/**
 * Transactional email templates.
 *
 * Rendered as inline-styled tables rather than a CSS framework, because that
 * is the only thing Outlook and Gmail agree on. Every template also produces a
 * plaintext part for deliverability.
 */

export interface TemplateData {
  otp: { name?: string; code: string; purpose: string; ttlMinutes: number };
  welcome: { name: string };
  booking_confirmed: {
    name: string;
    bookingCode: string;
    eventTitle: string;
    eventDate: string;
    venue: string;
    quantity: number;
    totalPaise: number;
    ticketUrl: string;
  };
  payment_confirmed: {
    name: string;
    bookingCode: string;
    amountPaise: number;
    method: string;
    paymentId: string;
  };
  booking_cancelled: {
    name: string;
    bookingCode: string;
    eventTitle: string;
    reason: string;
    refundPaise: number;
  };
  refund_processed: {
    name: string;
    bookingCode: string;
    amountPaise: number;
  };
  event_reminder: {
    name: string;
    eventTitle: string;
    eventDate: string;
    venue: string;
    bookingCode: string;
    ticketUrl: string;
  };
  organizer_verified: { name: string; organizerName: string };
  event_approved: { name: string; eventTitle: string; eventUrl: string };
  event_rejected: { name: string; eventTitle: string; reason: string };
}

export type TemplateName = keyof TemplateData;

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const BRAND = '#e11d48';

function layout(heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr><td style="background:${BRAND};padding:20px 28px;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.02em;">Evento</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#18181b;">${heading}</h1>
          <div style="font-size:15px;line-height:1.6;color:#3f3f46;">${bodyHtml}</div>
          ${
            cta
              ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;"><tr><td style="border-radius:8px;background:${BRAND};">
                   <a href="${cta.url}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">${cta.label}</a>
                 </td></tr></table>`
              : ''
          }
        </td></tr>
        <tr><td style="padding:18px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a;">
          Need help? Reply to this email and our team will get back to you.<br>
          <span style="color:#a1a1aa;">© ${new Date().getFullYear()} Evento. All rights reserved.</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function detailRows(pairs: Array<[string, string]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0;border-collapse:collapse;">
    ${pairs
      .map(
        ([label, value]) =>
          `<tr>
             <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;color:#71717a;font-size:14px;">${label}</td>
             <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;color:#18181b;font-size:14px;font-weight:600;text-align:right;">${value}</td>
           </tr>`,
      )
      .join('')}
  </table>`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderTemplate<T extends TemplateName>(name: T, data: TemplateData[T]): Rendered {
  switch (name) {
    case 'otp': {
      const d = data as TemplateData['otp'];
      const body = `
        <p>Use the verification code below to continue. It expires in ${d.ttlMinutes} minutes.</p>
        <div style="margin:22px 0;padding:16px;background:#fafafa;border:1px dashed #d4d4d8;border-radius:10px;text-align:center;">
          <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#18181b;">${d.code}</span>
        </div>
        <p style="color:#71717a;font-size:13px;">If you didn't request this, you can safely ignore this email — no changes were made to your account.</p>`;
      return {
        subject: `${d.code} is your Evento verification code`,
        html: layout(`Hi${d.name ? ` ${d.name}` : ''}, verify it's you`, body),
        text: `Your Evento verification code is ${d.code}. It expires in ${d.ttlMinutes} minutes.`,
      };
    }

    case 'welcome': {
      const d = data as TemplateData['welcome'];
      const body = `<p>Welcome to Evento! Your account is ready.</p>
        <p>Discover concerts, comedy nights, workshops and more happening around you — and book in a single tap.</p>`;
      return {
        subject: 'Welcome to Evento 🎉',
        html: layout(`Welcome aboard, ${d.name}`, body, { label: 'Explore events', url: env.webBaseUrl }),
        text: `Welcome to Evento, ${d.name}! Start exploring events at ${env.webBaseUrl}`,
      };
    }

    case 'booking_confirmed': {
      const d = data as TemplateData['booking_confirmed'];
      const body = `<p>Your booking is confirmed. Show the QR code at the venue entrance for a contactless check-in.</p>
        ${detailRows([
          ['Booking ID', d.bookingCode],
          ['Event', d.eventTitle],
          ['When', d.eventDate],
          ['Venue', d.venue],
          ['Tickets', String(d.quantity)],
          ['Amount paid', formatINR(d.totalPaise)],
        ])}`;
      return {
        subject: `Booking confirmed — ${d.eventTitle} (${d.bookingCode})`,
        html: layout('You’re going! 🎟️', body, { label: 'View your ticket', url: d.ticketUrl }),
        text: `Booking ${d.bookingCode} confirmed for ${d.eventTitle} on ${d.eventDate} at ${d.venue}. ${d.quantity} ticket(s), ${formatINR(d.totalPaise)}. View: ${d.ticketUrl}`,
      };
    }

    case 'payment_confirmed': {
      const d = data as TemplateData['payment_confirmed'];
      const body = `<p>We've received your payment. Here's your receipt.</p>
        ${detailRows([
          ['Booking ID', d.bookingCode],
          ['Amount', formatINR(d.amountPaise)],
          ['Method', d.method.toUpperCase()],
          ['Payment reference', d.paymentId],
        ])}`;
      return {
        subject: `Payment received — ${formatINR(d.amountPaise)} (${d.bookingCode})`,
        html: layout('Payment successful', body),
        text: `Payment of ${formatINR(d.amountPaise)} received for booking ${d.bookingCode}. Reference: ${d.paymentId}`,
      };
    }

    case 'booking_cancelled': {
      const d = data as TemplateData['booking_cancelled'];
      const body = `<p>Your booking <strong>${d.bookingCode}</strong> for <strong>${d.eventTitle}</strong> has been cancelled.</p>
        ${detailRows([
          ['Reason', d.reason],
          ...(d.refundPaise > 0 ? ([['Refund initiated', formatINR(d.refundPaise)]] as Array<[string, string]>) : []),
        ])}
        ${d.refundPaise > 0 ? '<p style="color:#71717a;font-size:13px;">Refunds typically reach your original payment method within 5–7 business days.</p>' : ''}`;
      return {
        subject: `Booking cancelled — ${d.bookingCode}`,
        html: layout('Booking cancelled', body),
        text: `Booking ${d.bookingCode} for ${d.eventTitle} was cancelled. Reason: ${d.reason}.`,
      };
    }

    case 'refund_processed': {
      const d = data as TemplateData['refund_processed'];
      const body = `<p>Your refund of <strong>${formatINR(d.amountPaise)}</strong> for booking <strong>${d.bookingCode}</strong> has been processed.</p>
        <p style="color:#71717a;font-size:13px;">It should reach your original payment method within 5–7 business days.</p>`;
      return {
        subject: `Refund processed — ${formatINR(d.amountPaise)}`,
        html: layout('Refund on its way', body),
        text: `Refund of ${formatINR(d.amountPaise)} processed for booking ${d.bookingCode}.`,
      };
    }

    case 'event_reminder': {
      const d = data as TemplateData['event_reminder'];
      const body = `<p>Your event is coming up soon. Don't forget your ticket!</p>
        ${detailRows([
          ['Event', d.eventTitle],
          ['When', d.eventDate],
          ['Venue', d.venue],
          ['Booking ID', d.bookingCode],
        ])}`;
      return {
        subject: `Reminder: ${d.eventTitle} is coming up`,
        html: layout(`See you soon, ${d.name}`, body, { label: 'Open my ticket', url: d.ticketUrl }),
        text: `Reminder: ${d.eventTitle} on ${d.eventDate} at ${d.venue}. Booking ${d.bookingCode}. Ticket: ${d.ticketUrl}`,
      };
    }

    case 'organizer_verified': {
      const d = data as TemplateData['organizer_verified'];
      const body = `<p><strong>${d.organizerName}</strong> has been verified. You can now publish events and start selling tickets.</p>`;
      return {
        subject: 'Your organizer account is verified ✅',
        html: layout(`Congratulations, ${d.name}`, body, {
          label: 'Go to dashboard',
          url: `${env.webBaseUrl}/organizer`,
        }),
        text: `${d.organizerName} has been verified. Publish your first event at ${env.webBaseUrl}/organizer`,
      };
    }

    case 'event_approved': {
      const d = data as TemplateData['event_approved'];
      const body = `<p>Your event <strong>${d.eventTitle}</strong> has been approved and is now live for customers to book.</p>`;
      return {
        subject: `Approved: ${d.eventTitle} is live`,
        html: layout('Your event is live 🎉', body, { label: 'View listing', url: d.eventUrl }),
        text: `${d.eventTitle} has been approved and is now live: ${d.eventUrl}`,
      };
    }

    case 'event_rejected': {
      const d = data as TemplateData['event_rejected'];
      const body = `<p>Your event <strong>${d.eventTitle}</strong> was not approved.</p>
        ${detailRows([['Reason', d.reason]])}
        <p>Update the listing and submit it again — we'll take another look.</p>`;
      return {
        subject: `Action needed: ${d.eventTitle}`,
        html: layout('Event needs changes', body, {
          label: 'Edit event',
          url: `${env.webBaseUrl}/organizer/events`,
        }),
        text: `${d.eventTitle} was not approved. Reason: ${d.reason}`,
      };
    }

    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown email template: ${String(exhaustive)}`);
    }
  }
}

export { stripHtml };
