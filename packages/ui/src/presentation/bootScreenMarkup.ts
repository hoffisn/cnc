import { BRAND_MARK, BRAND_MARK_TOOLPATH_LENGTH, renderBrandMarkSvg } from './brandMark';

/**
 * The boot screen is part of the page itself, so it is visible while the application bundle
 * is still loading. This module only builds its markup and runs at build time as well.
 */
export const BOOT_SCREEN_ID = 'boot-screen';
export const BOOT_SCREEN_HIDDEN_CLASS = 'boot-screen--hidden';
/** Duration of the fade-out. */
export const BOOT_SCREEN_FADE_OUT_MS = 320;

const BOOT_SCREEN_STYLE = `
#${BOOT_SCREEN_ID} {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
  background: #f2f3f5; color: ${BRAND_MARK.foregroundColor};
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  transition: opacity ${BOOT_SCREEN_FADE_OUT_MS}ms ease, visibility ${BOOT_SCREEN_FADE_OUT_MS}ms;
}
#${BOOT_SCREEN_ID}.${BOOT_SCREEN_HIDDEN_CLASS} { opacity: 0; visibility: hidden; }
.boot-screen__mark {
  width: 76px; height: 76px; border-radius: 22px;
  box-shadow: 0 14px 36px rgb(28 28 30 / 14%);
  animation: boot-screen-rise 520ms cubic-bezier(.2, .8, .2, 1) both;
}
.boot-screen__mark-toolpath {
  stroke-dasharray: ${BRAND_MARK_TOOLPATH_LENGTH};
  stroke-dashoffset: ${BRAND_MARK_TOOLPATH_LENGTH};
  animation: boot-screen-draw 620ms 180ms ease-in-out forwards;
}
.boot-screen__mark-cutter {
  transform-origin: ${BRAND_MARK.cutter.centerX}px ${BRAND_MARK.cutter.centerY}px;
  transform: scale(0);
  animation: boot-screen-pop 260ms 760ms cubic-bezier(.3, 1.6, .5, 1) forwards;
}
.boot-screen__name { font-size: 20px; font-weight: 700; letter-spacing: .01em; }
.boot-screen__progress {
  position: relative; width: 120px; height: 3px; overflow: hidden;
  border-radius: 2px; background: #e4e6ea;
}
.boot-screen__progress::after {
  content: ''; position: absolute; inset: 0; width: 40%;
  border-radius: 2px; background: ${BRAND_MARK.foregroundColor};
  animation: boot-screen-progress 1100ms ease-in-out infinite;
}
@keyframes boot-screen-rise { from { opacity: 0; transform: translateY(8px) scale(.94); } }
@keyframes boot-screen-draw { to { stroke-dashoffset: 0; } }
@keyframes boot-screen-pop { to { transform: scale(1); } }
@keyframes boot-screen-progress { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
@media (prefers-reduced-motion: reduce) {
  .boot-screen__mark, .boot-screen__mark-toolpath, .boot-screen__mark-cutter, .boot-screen__progress::after {
    animation: none; stroke-dashoffset: 0; transform: none;
  }
}`;

/** Markup put into `index.html` at build time, before the application script. */
export function renderBootScreen(): { readonly style: string; readonly body: string; readonly favicon: string } {
  return {
    style: BOOT_SCREEN_STYLE,
    favicon: `data:image/svg+xml,${encodeURIComponent(renderBrandMarkSvg('favicon'))}`,
    body: [
      `<div id="${BOOT_SCREEN_ID}" role="status" aria-label="Загрузка">`,
      renderBrandMarkSvg('boot-screen__mark'),
      '<div class="boot-screen__name">Резец</div>',
      '<div class="boot-screen__progress"></div>',
      '</div>',
    ].join(''),
  };
}
