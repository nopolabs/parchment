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
}

export function getConfig(env: { SITE_ID: string }): SiteConfig {
  switch (env.SITE_ID) {
    case 'mtw':  return mtwConfig  as SiteConfig;
    case 'bbpp': return bbppConfig as SiteConfig;
    default:
      throw new Error(`Unknown SITE_ID: "${env.SITE_ID}". Expected "mtw" or "bbpp".`);
  }
}
