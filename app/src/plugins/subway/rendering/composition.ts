// Yamanote and Hibiya show one 16:9 screen; Sakaisuji's wide panel (and the loading state) keep the wide layout.
export const isWidescreen = (line = '') => line === 'yamanote' || line === 'hibiya';

export function subwayComposition(compact: boolean, line = '') {
  const widescreen = isWidescreen(line);
  if (compact && widescreen)
    return {
      height: 1152,
      lcd: { x: 24, y: 24, w: 1280, h: 720 },
      strip: { x: 24, y: 800, w: 1600, h: 304 },
      side: { x: 1656, y: 800, w: 240, h: 304 },
      sign: { x: 1352, y: 24, w: 520, h: 180 },
      views: { x: 1352, y: 248, w: 520, h: 280 },
      pages: { x: 1352, y: 568, w: 520, h: 176 },
    };
  if (!compact && widescreen)
    return {
      height: 480,
      lcd: { x: 24, y: 24, w: 768, h: 432 },
      strip: { x: 840, y: 320, w: 1056, h: 136 },
      side: { x: 1384, y: 24, w: 256, h: 256 },
      sign: { x: 840, y: 24, w: 504, h: 120 },
      views: { x: 840, y: 176, w: 504, h: 104 },
      pages: { x: 1680, y: 168, w: 216, h: 112 },
    };
  return compact
    ? {
        height: 960,
        lcd: { x: 24, y: 24, w: 1872, h: 520 },
        strip: { x: 24, y: 736, w: 1600, h: 192 },
        side: { x: 1656, y: 736, w: 240, h: 192 },
        sign: { x: 24, y: 568, w: 800, h: 144 },
        views: { x: 872, y: 584, w: 760, h: 112 },
        pages: { x: 1656, y: 584, w: 240, h: 112 },
      }
    : {
        height: 480,
        lcd: { x: 24, y: 24, w: 1320, h: 320 },
        strip: { x: 24, y: 360, w: 1320, h: 96 },
        side: { x: 1392, y: 264, w: 256, h: 192 },
        sign: { x: 1392, y: 24, w: 480, h: 120 },
        views: { x: 1392, y: 164, w: 480, h: 76 },
        pages: { x: 1680, y: 304, w: 192, h: 112 },
      };
}

export const regionStyle = (rect: { x: number; y: number; w: number; h: number }) =>
  `left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px`;
