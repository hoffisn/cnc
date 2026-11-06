import { BOOT_SCREEN_FADE_OUT_MS, BOOT_SCREEN_HIDDEN_CLASS, BOOT_SCREEN_ID } from './bootScreenMarkup';

/** The logo animation takes this long; hiding earlier would cut it off. */
const MIN_VISIBLE_MS = 900;

/** Fades the boot screen out once the interface is mounted, keeping it until its animation has played. */
export function dismissBootScreen(): void {
  const bootScreen = document.getElementById(BOOT_SCREEN_ID);
  if (!bootScreen) return;
  const remainingMs = Math.max(MIN_VISIBLE_MS - performance.now(), 0);
  window.setTimeout(() => {
    bootScreen.classList.add(BOOT_SCREEN_HIDDEN_CLASS);
    window.setTimeout(() => bootScreen.remove(), BOOT_SCREEN_FADE_OUT_MS);
  }, remainingMs);
}
