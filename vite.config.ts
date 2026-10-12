import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two builds:
//  - default: the installable PWA deployed by Vercel (dist/)
//  - "single": one self-contained HTML file for quick sharing/preview (dist-single/)
export default defineConfig(({ mode }) => {
  if (mode === 'single') {
    return {
      plugins: [viteSingleFile()],
      define: { __SINGLE__: true },
      resolve: { alias: { 'virtual:pwa-register': '/src/pwa-stub.ts' } },
      build: { outDir: 'dist-single', assetsInlineLimit: 100000000 },
    };
  }
  return {
    define: { __SINGLE__: false },
    plugins: [
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Liège Approach',
          short_name: 'LGG APP',
          description: 'Approach and departure radar simulator for Liège (EBLG)',
          theme_color: '#141b23',
          background_color: '#141b23',
          display: 'fullscreen',
          orientation: 'any',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], navigateFallbackDenylist: [/^\/api\//] },
      }),
    ],
  };
});
