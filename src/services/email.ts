import { config } from '../config';

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!config.resendApiKey) {
    console.log(`[EMAIL] No RESEND_API_KEY — would send "${subject}" to ${to}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `FlowShift <${config.fromEmail}>`,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}
