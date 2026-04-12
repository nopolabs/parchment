const RESEND_API_URL = 'https://api.resend.com/emails';

export async function sendCertificateEmail(
  to:       string,
  from:     string,
  siteName: string,
  png:      Uint8Array,
  apiKey:   string,
): Promise<void> {
  const base64Png = Buffer.from(png).toString('base64');

  const payload = {
    from:        `${siteName} <${from}>`,
    to:          [to],
    subject:     `Your ${siteName} Certificate`,
    html:        `<p>Congratulations! Your <strong>${siteName}</strong> certificate is attached.</p>`,
    attachments: [
      {
        filename: 'certificate.png',
        content:  base64Png,
      },
    ],
  };

  const response = await fetch(RESEND_API_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.warn('parchment: email send failed', response.status, text);
    throw new Error(`email send failed: ${response.status}`);
  }
}
