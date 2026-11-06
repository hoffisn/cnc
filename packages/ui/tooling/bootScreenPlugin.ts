import type { Plugin } from 'vite';
import { renderBootScreen } from '../src/presentation/bootScreenMarkup';

/** Puts the boot screen into the page, so it is drawn before any script has loaded. */
export function bootScreenPlugin(): Plugin {
  return {
    name: 'rezets-boot-screen',
    transformIndexHtml(html) {
      const { style, body, favicon } = renderBootScreen();
      return {
        html: html.replace(/<body([^>]*)>/, (opening) => `${opening}\n    ${body}`),
        tags: [
          { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: favicon }, injectTo: 'head' },
          { tag: 'style', children: style, injectTo: 'head' },
        ],
      };
    },
  };
}
