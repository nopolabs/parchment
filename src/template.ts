import type { SiteConfig } from './config.ts';

type SatoriNode = {
  type: string;
  props: Record<string, unknown>;
};

function node(type: string, props: Record<string, unknown>, ...children: (SatoriNode | string)[]): SatoriNode {
  if (children.length === 0) return { type, props };
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } };
}

export function buildTemplate(
  config:      SiteConfig,
  name:        string,
  achievement: string,
  sealDataUrl: string | null,
): object {
  const { palette, fonts } = config;

  const issueDate = new Date().toLocaleDateString('en-US', {
    year:  'numeric',
    month: 'long',
    day:   'numeric',
  });

  const sealElement: SatoriNode = sealDataUrl !== null
    ? node('img', {
        src:    sealDataUrl,
        width:  80,
        height: 80,
        style:  { objectFit: 'contain' },
      })
    : node('div', { style: { width: 80, height: 80 } });

  return node('div', {
    style: {
      width:           1200,
      height:          850,
      backgroundColor: palette.background,
      display:         'flex',
      flexDirection:   'column',
      alignItems:      'center',
      padding:         20,
    },
  },
    // Outer border container
    node('div', {
      style: {
        flex:          1,
        width:         '100%',
        border:        `6px solid ${palette.border}`,
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        padding:       40,
      },
    },
      // Inner decorative rule container
      node('div', {
        style: {
          flex:          1,
          width:         '100%',
          border:        `2px solid ${palette.border}`,
          display:       'flex',
          flexDirection: 'column',
          alignItems:    'center',
          justifyContent:'space-between',
          padding:       '60px 40px 48px 40px',
        },
      },
        // Top content group
        node('div', {
          style: {
            display:       'flex',
            flexDirection: 'column',
            alignItems:    'center',
            width:         '100%',
          },
        },
          // Zone 1 — Site name
          node('div', {
            style: {
              fontFamily:    fonts.bodyFamily,
              fontWeight:    400,
              fontSize:      18,
              color:         palette.bodyText,
              letterSpacing: 4,
              textTransform: 'uppercase',
              textAlign:     'center',
            },
          }, config.siteName),

          // Zone 2 — Certificate title
          node('div', {
            style: {
              fontFamily: fonts.titleFamily,
              fontWeight: 700,
              fontSize:   52,
              color:      palette.titleText,
              textAlign:  'center',
              marginTop:  20,
            },
          }, config.certificateTitle),

          // Zone 3 — Decorative divider
          node('div', {
            style: {
              width:       480,
              height:      1,
              backgroundColor: palette.border,
              marginTop:   24,
            },
          }),

          // Zone 4 — Recipient label
          node('div', {
            style: {
              fontFamily: fonts.bodyFamily,
              fontWeight: 400,
              fontSize:   20,
              color:      palette.bodyText,
              fontStyle:  'italic',
              textAlign:  'center',
              marginTop:  28,
            },
          }, config.recipientLabel),

          // Zone 5 — Recipient name
          node('div', {
            style: {
              fontFamily: fonts.titleFamily,
              fontWeight: 700,
              fontSize:   72,
              color:      palette.nameText,
              textAlign:  'center',
              marginTop:  8,
            },
          }, name),

          // Zone 6 — Achievement label
          node('div', {
            style: {
              fontFamily:    fonts.bodyFamily,
              fontWeight:    400,
              fontSize:      24,
              color:         palette.accent,
              letterSpacing: 2,
              textTransform: 'uppercase',
              textAlign:     'center',
              marginTop:     20,
            },
          }, config.achievementLabel),

          // Zone 7 — Achievement subtitle
          node('div', {
            style: {
              fontFamily: fonts.bodyFamily,
              fontWeight: 400,
              fontSize:   18,
              color:      palette.bodyText,
              fontStyle:  'italic',
              textAlign:  'center',
              marginTop:  8,
              maxWidth:   700,
              flexWrap:   'wrap',
              display:    'flex',
            },
          }, achievement),
        ),

        // Zone 8 — Footer row
        node('div', {
          style: {
            display:        'flex',
            flexDirection:  'row',
            justifyContent: 'space-between',
            alignItems:     'center',
            width:          '100%',
          },
        },
          node('div', {
            style: {
              fontFamily: fonts.bodyFamily,
              fontSize:   14,
              color:      palette.bodyText,
            },
          }, issueDate),

          sealElement,

          node('div', {
            style: {
              fontFamily: fonts.bodyFamily,
              fontSize:   14,
              color:      palette.bodyText,
            },
          }, config.siteName),
        ),
      ),
    ),
  );
}
