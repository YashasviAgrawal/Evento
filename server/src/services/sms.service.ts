/**
 * SMS — currently only sign-in codes.
 *
 * Indian SMS must use a DLT-registered template, so the provider is given a
 * template id and the variable, not free text. MSG91's Flow API is used; any
 * other provider fits behind `sendOtpSms`. Without keys the code is logged,
 * so development and CI never need a real SMS account.
 */
import { env } from '../config/env';
import { logger } from '../config/logger';
import { ServiceUnavailableError } from '../utils/errors';

export async function sendOtpSms(mobile10: string, code: string): Promise<void> {
  if (!env.sms.enabled) {
    logger.info({ mobile: `••••••${mobile10.slice(-4)}`, code }, 'SMS (console transport — MSG91 not configured)');
    return;
  }
  try {
    const response = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { authkey: env.sms.msg91AuthKey!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        template_id: env.sms.msg91OtpTemplateId,
        short_url: '0',
        recipients: [{ mobiles: `91${mobile10}`, otp: code }],
      }),
    });
    if (!response.ok) throw new Error(`MSG91 responded ${response.status}`);
  } catch (err) {
    logger.error({ err }, 'SMS send failed');
    throw new ServiceUnavailableError('We could not send the code by SMS — try email instead');
  }
}

/** "+91 98000-00001" / "098000 00001" → "9800000001"; null when not an Indian mobile. */
export function normalizeIndianMobile(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}
