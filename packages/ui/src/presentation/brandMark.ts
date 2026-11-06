/**
 * Geometry of the logo: the letter «Р» drawn as a toolpath, with the cutter standing after it.
 * Coordinates are in a 48 × 48 box; the same shapes are used for the app icons.
 */
export const BRAND_MARK = {
  viewBox: '0 0 48 48',
  cornerRadius: 12,
  toolpath: 'M17 36V12h9a7 7 0 0 1 0 14h-9',
  toolpathWidth: 4.5,
  cutter: { centerX: 31.5, centerY: 34, radius: 4 },
  backgroundColor: '#ffdd2d',
  foregroundColor: '#1c1c1e',
} as const;

/** Length of the toolpath stroke, used to animate it being drawn. */
export const BRAND_MARK_TOOLPATH_LENGTH = 64;

/** The logo as standalone SVG markup, for places outside Vue such as the boot screen. */
export function renderBrandMarkSvg(className: string): string {
  const { viewBox, cornerRadius, toolpath, toolpathWidth, cutter, backgroundColor, foregroundColor } = BRAND_MARK;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="${className}" viewBox="${viewBox}" aria-hidden="true">`,
    `<rect width="48" height="48" rx="${cornerRadius}" fill="${backgroundColor}"/>`,
    `<path class="${className}-toolpath" d="${toolpath}" fill="none" stroke="${foregroundColor}"`,
    ` stroke-width="${toolpathWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<circle class="${className}-cutter" cx="${cutter.centerX}" cy="${cutter.centerY}" r="${cutter.radius}" fill="${foregroundColor}"/>`,
    '</svg>',
  ].join('');
}
