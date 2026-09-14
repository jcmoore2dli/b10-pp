import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// TOEFL Prep — second Vite app in this repo, sibling to frontend/.
// base, the firebase.json hosting rewrite, and the PWA start_url/scope
// must all agree on '/toefl/'. See TOEFL_Frontend_Scaffold_Spec_v1_4.md.
export default defineConfig({
  base: '/toefl/',
  server: {
    host: '0.0.0.0',
    port: 5174,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Explicit, not defaulted: two PWAs on one origin means two service
      // workers, and TOEFL's must not intercept B10-PP's requests.
      scope: '/toefl/',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'TOEFL Prep',
        short_name: 'TOEFL',
        description: 'TOEFL Preparation Platform — DLIELC',
        theme_color: '#1e3a5f',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/toefl/',
        start_url: '/toefl/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,json}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
})
