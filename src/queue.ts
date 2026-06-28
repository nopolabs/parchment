import { getConfig }                            from './config.ts';
import { buildCacheKey, getCached, putCached }  from './r2.ts';
import { renderCertificate, ALL_FONTS }         from './render.ts';
import { findCertificate, insertCertificate }   from './db.ts';
import { sendCertificateEmail, type EmailCta }  from './email.ts';
import { mintToken }                            from './token.ts';

export interface IssueMessage {
  siteId:      string;
  name:        string;
  achievement: string;
  email:       string;
  // Set by the /issue handler, which now owns the D1 insert (the
  // personalization token must exist before /issue responds). Optional only
  // for messages already in flight when that change deployed.
  serial?:     string;
  token?:      string;
}

export async function handleQueue(
  batch: MessageBatch<IssueMessage>,
  env:   Env,
): Promise<void> {
  for (const msg of batch.messages) {
    const { siteId, name, achievement, email } = msg.body;
    const config = getConfig(siteId);
    const ach    = achievement || config.achievementSubtitle;
    const r2Key  = buildCacheKey(config.r2KeyPrefix, name, ach);

    try {
      let serial = msg.body.serial ?? null;
      let token  = msg.body.token  ?? null;
      if (serial === null) {
        // Legacy message from before the insert moved into /issue.
        const existing = await findCertificate(env.PARCHMENT_LOG, r2Key);
        if (existing) {
          serial = existing.serial;
          token  = existing.token;
        } else {
          token  = mintToken();
          serial = await insertCertificate(env.PARCHMENT_LOG, config.siteId, name, ach, r2Key, email, token);
        }
      }

      let png = await getCached(env.PARCHMENT, r2Key);
      if (!png) {
        png = await renderCertificate(config, name, ach, serial, ALL_FONTS);
        await putCached(env.PARCHMENT, r2Key, png);
      }

      let emailCta: EmailCta | null = null;
      if (token && config.emailCta) {
        emailCta = {
          ...config.emailCta,
          url: config.emailCta.url.replace('{token}', token),
        };
      } else if (token && config.printOfferUrl) {
        emailCta = {
          url:      config.printOfferUrl.replace('{token}', token),
          prefix:   'Forward this email to share the certificate, or ',
          linkText: 'order a keepsake',
          suffix:   ' with this certificate artwork.',
        };
      }

      try {
        await sendCertificateEmail(email, config.fromEmail, config.siteName, name, png, env.RESEND_API_KEY, emailCta);
      } catch (emailErr) {
        console.warn('parchment: email failed for', email, emailErr);
      }

      msg.ack();
    } catch (err) {
      console.error('parchment: queue processing error', err);
      msg.retry();
    }
  }
}
