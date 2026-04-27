import { getConfig }                            from './config.ts';
import { buildCacheKey, getCached, putCached }  from './r2.ts';
import { renderCertificate, ALL_FONTS }         from './render.ts';
import { findCertificate, insertCertificate }   from './db.ts';
import { sendCertificateEmail }                 from './email.ts';

export interface IssueMessage {
  siteId:      string;
  name:        string;
  achievement: string;
  email:       string;
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
      const existing = await findCertificate(env.PARCHMENT_LOG, r2Key);
      const serial   = existing
        ? existing.serial
        : await insertCertificate(env.PARCHMENT_LOG, config.siteId, name, ach, r2Key, email);

      let png = await getCached(env.PARCHMENT, r2Key);
      if (!png) {
        png = await renderCertificate(config, name, ach, serial, ALL_FONTS);
        await putCached(env.PARCHMENT, r2Key, png);
      }

      try {
        await sendCertificateEmail(email, config.fromEmail, config.siteName, png, env.RESEND_API_KEY);
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
