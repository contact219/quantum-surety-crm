import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import nodemailer from 'nodemailer';

const client = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Use nodemailer stream transport only to build raw MIME messages
const builder = nodemailer.createTransport({ streamTransport: true, newline: 'unix', buffer: true });

/**
 * Send a single email via AWS SES.
 * @param {object} opts  - from, to (string or array), subject, html, headers (optional)
 * @returns {{ id: string }}
 */
export async function sendEmail({ from, to, subject, html, headers = {} }) {
  const toArr = Array.isArray(to) ? to : [to];

  // Build raw MIME via nodemailer (supports custom headers)
  const { message } = await builder.sendMail({ from, to: toArr.join(', '), subject, html, headers });

  const cmd = new SendRawEmailCommand({
    RawMessage: { Data: message },
    Destinations: toArr,
  });
  const result = await client.send(cmd);
  return { id: result.MessageId };
}
