import satori from 'satori';
import type { Font as FontData } from 'satori';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

import playfairBold         from '../assets/fonts/PlayfairDisplay-Bold.ttf';
import latoRegular          from '../assets/fonts/Lato-Regular.ttf';
import cormorantSemibold    from '../assets/fonts/CormorantGaramond-SemiBold.ttf';
import sourceSansProRegular from '../assets/fonts/SourceSansPro-Regular.ttf';

import type { SiteConfig } from './config.ts';
import { buildCertTemplate } from './cert-template.ts';
import { buildMugTemplate, MUG_ARTWORK_HEIGHT, MUG_ARTWORK_WIDTH } from './mug-template.ts';

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

// Satori output is vector SVG; `scale` only changes the rasterization size
// (scale 3 → 3600×2550, true 300 DPI at 12×8.5"). Text and borders stay
// crisp at any scale; the seal is a raster source and upscales with it.
export async function renderCertificate(
  config:      SiteConfig,
  name:        string,
  achievement: string,
  serial:      string,
  fonts:       FontData[],
  scale:       number = 1,
): Promise<Uint8Array> {
  const sealDataUrl = await fetchSeal(config.sealAssetUrl);

  const svg = await satori(
    buildCertTemplate(config, name, achievement, sealDataUrl, serial),
    {
      width:  1200,
      height: 850,
      fonts,
    },
  );

  await wasmReady;
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 * scale } });
  const png   = resvg.render();
  return png.asPng();
}

export async function renderMugArtwork(
  config:      SiteConfig,
  name:        string,
  achievement: string,
  serial:      string,
  fonts:       FontData[],
): Promise<Uint8Array> {
  const sealDataUrl = await fetchSeal(config.sealAssetUrl);

  const svg = await satori(
    buildMugTemplate(config, name, achievement, sealDataUrl, serial),
    {
      width:  MUG_ARTWORK_WIDTH,
      height: MUG_ARTWORK_HEIGHT,
      fonts,
    },
  );

  await wasmReady;
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: MUG_ARTWORK_WIDTH } });
  const png   = resvg.render();
  return png.asPng();
}
