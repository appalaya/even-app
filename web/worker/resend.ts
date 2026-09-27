/**
 * Sends one email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email), the way the
 * company site's contact form does, from the same verified sending domain.
 *
 * Anything but a 2xx answer, a network failure or a timeout is a failed send. What comes back for the log is a
 * fixed code only: the HTTP status and Resend's documented error `name` (`daily_quota_exceeded` and so on), never
 * the rest of Resend's answer, whose `message` can quote addresses.
 */
import type { OutgoingEmail } from './message';

export const RESEND_SEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;
/** Resend rejects requests without a User-Agent (API reference, "Introduction"). */
const USER_AGENT = 'even-web/1 (+https://even.appalaya.com)';

export type SendResult = { ok: true } | { ok: false; detail: string };

export async function sendViaResend(apiKey: string, email: OutgoingEmail): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch(RESEND_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, detail: `resend_${error instanceof Error ? error.name : typeof error}` };
  }
  if (response.ok) return { ok: true };
  return { ok: false, detail: `resend_${response.status}${await errorName(response)}` };
}

/** `,<name>` when Resend's error body has a documented-looking `name`, otherwise nothing. */
async function errorName(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { name?: unknown } | null;
    const name = body?.name;
    return typeof name === 'string' && /^[a-z_]{1,60}$/.test(name) ? `,${name}` : '';
  } catch {
    return '';
  }
}
