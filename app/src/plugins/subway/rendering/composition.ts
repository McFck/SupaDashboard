// The design is 1920 px wide and as tall as the page's aspect, so it fills the page at one scale: the display
// takes everything above one control strip.
const DESIGN_WIDTH = 1920;
const STRIP_HEIGHT = 136;
const MIN_DISPLAY_HEIGHT = 240;

export function subwayComposition(viewport?: { width: number; height: number }) {
  const aspect =
    viewport && viewport.width > 0 && viewport.height > 0 ? viewport.height / viewport.width : 0.25;
  const height = Math.max(STRIP_HEIGHT + MIN_DISPLAY_HEIGHT, Math.round(DESIGN_WIDTH * aspect));
  return {
    height,
    display: { w: DESIGN_WIDTH, h: height - STRIP_HEIGHT },
    strip: STRIP_HEIGHT,
  };
}
