import mtwConfig  from '../config/mtw.json';
import bbppConfig from '../config/bbpp.json';

export interface Palette {
  background: string;
  border:     string;
  titleText:  string;
  bodyText:   string;
  accent:     string;
  nameText:   string;
}

export interface FontConfig {
  titleFamily: string;
  bodyFamily:  string;
}

export interface EmailCtaConfig {
  url:      string;
  linkText: string;
  prefix?:  string;
  suffix?:  string;
}

export interface SiteConfig {
  siteId:              string;
  siteName:            string;
  certificateTitle:    string;
  recipientLabel:      string;
  achievementLabel:    string;
  achievementSubtitle: string;
  palette:             Palette;
  fonts:               FontConfig;
  sealAssetUrl:        string;
  r2KeyPrefix:         string;
  fromEmail:           string;
  // Optional token-backed email CTA; "{token}" in url is replaced with the
  // certificate's personalization token. When absent, the certificate email
  // carries no purchase link.
  emailCta?:           EmailCtaConfig;
  // Deprecated. Kept so older site configs still get a generic token-backed
  // keepsake CTA until they migrate to emailCta.
  printOfferUrl?:      string;
}

export function getConfig(siteId: string): SiteConfig {
  switch (siteId) {
    case 'mtw':  return mtwConfig  as SiteConfig;
    case 'bbpp': return bbppConfig as SiteConfig;
    default:
      throw new Error(`Unknown site: "${siteId}". Expected "mtw" or "bbpp".`);
  }
}

export function getIssueApiKey(siteId: string, env: Env): string {
  switch (siteId) {
    case 'mtw':  return env.MTW_ISSUE_API_KEY;
    case 'bbpp': return env.BBPP_ISSUE_API_KEY;
    default:
      throw new Error(`No ISSUE_API_KEY configured for site: "${siteId}"`);
  }
}
