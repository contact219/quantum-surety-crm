import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const client = new SESv2Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Send a single email via AWS SES v2.
 * @param {object} opts  - from, to (string or array), subject, html, headers (optional)
 * @returns {{ id: string }}
 */
export async function sendEmail({ from, to, subject, html, headers = {} }) {
  const toArr = Array.isArray(to) ? to : [to];
  const headersList = Object.entries(headers).map(([Name, Value]) => ({ Name, Value: String(Value) }));

  const cmd = new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: toArr },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
        ...(headersList.length > 0 && { Headers: headersList }),
      },
    },
  });

  const result = await client.send(cmd);
  return { id: result.MessageId };
}
