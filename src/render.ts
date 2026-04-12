import satori from 'satori';
import type { Font as FontData } from 'satori';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

import playfairBold         from '../assets/fonts/PlayfairDisplay-Bold.ttf';
import latoRegular          from '../assets/fonts/Lato-Regular.ttf';
import cormorantSemibold    from '../assets/fonts/CormorantGaramond-SemiBold.ttf';
import sourceSansProRegular from '../assets/fonts/SourceSansPro-Regular.ttf';

import type { SiteConfig } from './config.ts';
import { buildTemplate } from './template.ts';

export type { FontData };

const wasmReady: Promise<void> = initWasm(resvgWasm);

export const ALL_FONTS: FontData[] = [
  { name: 'Playfair Display',   data: playfairBold,         weight: 700, style: 'normal' },
  { name: 'Lato',               data: latoRegular,          weight: 400, style: 'normal' },
  { name: 'Cormorant Garamond', data: cormorantSemibold,    weight: 600, style: 'normal' },
  { name: 'Source Sans Pro',    data: sourceSansProRegular, weight: 400, style: 'normal' },
];

async function fetchSeal(sealAssetUrl: string): Promise<string | null> {
  try {
    const response = await fetch(sealAssetUrl);
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
      console.warn('parchment: seal fetch failed', sealAssetUrl, response.status);
      return null;
    }
    const contentType = response.headers.get('content-type') ?? 'image/png';
    const base64 = Buffer.from(await response.arrayBuffer()).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.warn('parchment: seal fetch failed', sealAssetUrl, err);
    return null;
  }
}

export async function renderCertificate(
  config:      SiteConfig,
  name:        string,
  achievement: string,
  serial:      string,
  fonts:       FontData[],
): Promise<Uint8Array> {
  const sealDataUrl = await fetchSeal(config.sealAssetUrl);

  const svg = await satori(
    buildTemplate(config, name, achievement, sealDataUrl, serial),
    {
      width:  1200,
      height: 850,
      fonts,
    },
  );

  await wasmReady;
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const png   = resvg.render();
  return png.asPng();
}
