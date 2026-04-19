import Mailgun from 'mailgun.js';
import FormData from 'form-data';

const mailgun = new Mailgun(FormData);

export const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY,
});

export const DOMAIN = process.env.MAILGUN_DOMAIN || 'quantumsurety.bond';

/**
 * Send a single email via Mailgun.
 * @param {object} opts  - from, to (string or array), subject, html, headers (optional)
 * @returns Mailgun message response
 */
export async function sendEmail({ from, to, subject, html, headers = {} }) {
  const msg = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  // Mailgun custom headers use the "h:" prefix
  for (const [key, val] of Object.entries(headers)) {
    msg[`h:${key}`] = val;
  }
  return mg.messages.create(DOMAIN, msg);
}
