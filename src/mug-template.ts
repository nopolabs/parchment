import type { SiteConfig } from './config.ts';

type SatoriNode = {
  type: string;
  props: Record<string, unknown>;
};

const WIDTH = 2700;
const HEIGHT = 1050;
const SEAL_FACE_CENTER = 585;
const TEXT_FACE_CENTER = 2115;

function node(type: string, props: Record<string, unknown>, ...children: (SatoriNode | string)[]): SatoriNode {
  if (children.length === 0) return { type, props };
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } };
}

function centeredStyle(style: Record<string, unknown>): Record<string, unknown> {
  return {
    ...style,
    textAlign:      'center',
    display:        'flex',
    justifyContent: 'center',
  };
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? current + ' ' + word : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function nameFontSize(name: string): number {
  if (name.length <= 20) return 66;
  if (name.length <= 32) return 54;
  if (name.length <= 45) return 44;
  return 36;
}

function titleLines(title: string): string[] {
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 20) return [normalized];

  const words = normalized.split(' ');
  const midpoint = normalized.length / 2;
  let bestIndex = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let length = 0;

  for (let index = 0; index < words.length - 1; index++) {
    const word = words[index] ?? '';
    length += word.length + (index === 0 ? 0 : 1);
    const distance = Math.abs(length - midpoint);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index + 1;
    }
  }

  return [
    words.slice(0, bestIndex).join(' '),
    words.slice(bestIndex).join(' '),
  ];
}

function achievementBlock(achievement: string, color: string, fontFamily: string): SatoriNode[] {
  const lines = wrapText(achievement, 46);
  const top = 570;
  const bottom = 650;
  const available = bottom - top;
  const count = Math.max(1, lines.length);
  const fontSize = Math.max(14, Math.min(23, Math.floor((available / count) * 0.72)));
  const lineHeight = Math.floor(fontSize * 1.35);
  const blockHeight = lineHeight * (count - 1);
  const firstBaseline = top + Math.floor((available - blockHeight) / 2);

  return lines.map((line, index) => node('div', {
    style: centeredStyle({
      position:   'absolute',
      left:       65,
      top:        firstBaseline - fontSize + index * lineHeight,
      width:      530,
      fontFamily,
      fontSize,
      fontStyle:  'italic',
      color,
    }),
  }, line));
}

function sealFace(sealDataUrl: string | null): SatoriNode {
  const x = SEAL_FACE_CENTER - 300;

  if (sealDataUrl === null) {
    return node('div', {
      style: {
        position: 'absolute',
        left:     x - 20,
        top:      205,
        width:    640,
        height:   640,
      },
    });
  }

  return node('img', {
    src:    sealDataUrl,
    width:  640,
    height: 640,
    style:  {
      position:  'absolute',
      left:      x - 20,
      top:       205,
      objectFit: 'contain',
    },
  });
}

function textFace(config: SiteConfig, name: string, achievement: string, serial: string): SatoriNode {
  const { palette, fonts } = config;
  const [titleTop = '', titleBottom = ''] = titleLines(config.certificateTitle);
  const x = TEXT_FACE_CENTER - 330;
  const issueDate = new Date().toLocaleDateString('en-US', {
    year:  'numeric',
    month: 'long',
    day:   'numeric',
  });

  return node('div', {
    style: {
      position: 'absolute',
      left:     x,
      top:      165,
      width:    660,
      height:   710,
      border:   `4px solid ${palette.accent}`,
      borderRadius: 18,
      display:  'flex',
    },
  },
    node('div', {
      style: centeredStyle({
        position:   'absolute',
        left:       40,
        top:        67,
        width:      580,
        fontFamily: fonts.titleFamily,
        fontWeight: 600,
        fontSize:   64,
        color:      palette.titleText,
      }),
    }, titleTop),
    node('div', {
      style: centeredStyle({
        position:   'absolute',
        left:       40,
        top:        138,
        width:      580,
        fontFamily: fonts.titleFamily,
        fontWeight: 600,
        fontSize:   82,
        color:      palette.titleText,
      }),
    }, titleBottom ?? ''),
    node('div', {
      style: {
        position:        'absolute',
        left:            160,
        top:             235,
        width:           340,
        height:          5,
        backgroundColor: palette.accent,
        borderRadius:    3,
      },
    }),
    node('div', {
      style: centeredStyle({
        position:   'absolute',
        left:       65,
        top:        286,
        width:      530,
        fontFamily: fonts.bodyFamily,
        fontSize:   28,
        fontStyle:  'italic',
        color:      palette.bodyText,
      }),
    }, config.recipientLabel),
    node('div', {
      style: centeredStyle({
        position:   'absolute',
        left:       50,
        top:        332,
        width:      560,
        fontFamily: fonts.titleFamily,
        fontWeight: 600,
        fontSize:   nameFontSize(name),
        color:      palette.nameText,
      }),
    }, name),
    node('div', {
      style: centeredStyle({
        position:      'absolute',
        left:          40,
        top:           478,
        width:         580,
        fontFamily:    fonts.bodyFamily,
        fontSize:      26,
        color:         palette.accent,
        letterSpacing: 4,
        textTransform: 'uppercase',
      }),
    }, config.achievementLabel),
    ...achievementBlock(achievement, palette.bodyText, fonts.bodyFamily),
    node('div', {
      style: {
        position:   'absolute',
        left:       65,
        top:        655,
        width:      230,
        fontFamily: fonts.bodyFamily,
        fontSize:   19,
        color:      palette.bodyText,
      },
    }, issueDate),
    node('div', {
      style: {
        position:   'absolute',
        right:      65,
        top:        655,
        width:      230,
        fontFamily: fonts.bodyFamily,
        fontSize:   19,
        color:      palette.bodyText,
        textAlign:  'right',
      },
    }, serial),
  );
}

export function buildMugTemplate(
  config:      SiteConfig,
  name:        string,
  achievement: string,
  sealDataUrl: string | null,
  serial:      string,
): object {
  return node('div', {
    style: {
      position:        'relative',
      width:           WIDTH,
      height:          HEIGHT,
      backgroundColor: '#ffffff',
      display:         'flex',
    },
  },
    sealFace(sealDataUrl),
    textFace(config, name, achievement, serial),
  );
}

export const MUG_ARTWORK_WIDTH = WIDTH;
export const MUG_ARTWORK_HEIGHT = HEIGHT;
