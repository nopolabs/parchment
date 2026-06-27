const RESEND_API_URL = 'https://api.resend.com/emails';

// The recipient name is user-supplied (the awarder typed it) and lands in the
// email HTML, so escape it. siteName/printOfferUrl are config-controlled.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendCertificateEmail(
  to:            string,
  from:          string,
  siteName:      string,
  name:          string,
  png:           Uint8Array,
  apiKey:        string,
  printOfferUrl: string | null = null,
): Promise<void> {
  const base64Png = Buffer.from(png).toString('base64');
  const safeName  = escapeHtml(name);

  // Audience-neutral: the certificate is emailed to whatever address the
  // awarder entered — possibly their own (to deliver it themselves or keep it
  // a surprise), possibly the awardee's. Naming the awardee in the third
  // person reads correctly either way, and the offered actions suit both.
  const printOffer = printOfferUrl
    ? `<p>Forward this email to share the certificate, or <a href="${printOfferUrl}">order a custom mug</a> with this prize artwork.</p>`
    : '';

  const payload = {
    from:        `${siteName} <${from}>`,
    to:          [to],
    subject:     `A ${siteName} certificate for ${name}`,
    html:        `<p>Congratulations to <strong>${safeName}</strong> — the <strong>${siteName}</strong> certificate is attached.</p>${printOffer}`,
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
