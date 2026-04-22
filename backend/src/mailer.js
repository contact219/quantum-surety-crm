import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import nodemailer from 'nodemailer';

const client = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const transporter = nodemailer.createTransport({
  SES: { ses: client, aws: { SendEmailCommand } },
});

/**
 * Send a single email via AWS SES.
 * @param {object} opts  - from, to (string or array), subject, html, headers (optional)
 * @returns {{ id: string }}
 */
export async function sendEmail({ from, to, subject, html, headers = {} }) {
  const result = await transporter.sendMail({
    from,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
    headers,
  });
  return { id: result.messageId };
}
