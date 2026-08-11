import { Resend } from 'resend';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { query } from '../db/pool';
import { renderTemplate, type TemplateName, type TemplateData } from './mail.templates';

const client = env.mail.enabled ? new Resend(env.mail.resendApiKey) : null;

export interface SendMailInput<T extends TemplateName = TemplateName> {
  to: string;
  template: T;
  data: TemplateData[T];
  userId?: string | null;
  bookingId?: string | null;
  eventId?: string | null;
}

/**
 * Send a transactional email and record it in `notifications`.
 *
 * Two deliberate properties:
 *  1. Without RESEND_API_KEY the mail is logged and stored as "sent" rather
 *     than failing — local development and CI never need a real mail provider.
 *  2. A delivery failure never propagates. Nobody should lose a paid booking
 *     because the mail provider had a bad minute; the notification row records
 *     the failure for retry instead.
 */
export async function sendMail<T extends TemplateName>(input: SendMailInput<T>): Promise<void> {
  const { subject, html, text } = renderTemplate(input.template, input.data);

  const { rows } = await query<{ id: string }>(
    `INSERT INTO notifications (user_id, booking_id, event_id, channel, template, to_address, subject, payload, status)
     VALUES ($1, $2, $3, 'email', $4, $5, $6, $7, 'queued')
     RETURNING id`,
    [
      input.userId ?? null,
      input.bookingId ?? null,
      input.eventId ?? null,
      input.template,
      input.to,
      subject,
      JSON.stringify(input.data ?? {}),
    ],
  );
  const notificationId = rows[0]?.id;

  try {
    if (!client) {
      logger.info({ to: input.to, subject, template: input.template }, 'Email (console transport — RESEND_API_KEY not set)');
    } else {
      const result = await client.emails.send({
        from: env.mail.from,
        to: input.to,
        subject,
        html,
        text,
      });
      if (result.error) throw new Error(result.error.message);
    }

    if (notificationId) {
      await query("UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = $1", [notificationId]);
    }
  } catch (err) {
    logger.error({ err, to: input.to, template: input.template }, 'Failed to send email');
    if (notificationId) {
      await query("UPDATE notifications SET status = 'failed', error = $2 WHERE id = $1", [
        notificationId,
        err instanceof Error ? err.message : String(err),
      ]).catch(() => undefined);
    }
  }
}

/**
 * Fire-and-forget variant for paths where the caller must not wait on SMTP —
 * booking confirmation is returned to the customer immediately.
 */
export function sendMailAsync<T extends TemplateName>(input: SendMailInput<T>): void {
  void sendMail(input).catch((err) => logger.error({ err }, 'Background email failed'));
}
