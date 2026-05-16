/// <reference types="vitest/config" />

import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      injectRegister: 'auto',
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'My MD Reader',
        short_name: 'MD Reader',
        description: 'A personal offline-first Markdown reader.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#143b36',
        background_color: '#f4efe3',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}']
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/markdown-it') || id.includes('node_modules/highlight.js') || id.includes('node_modules/dompurify')) {
            return 'markdown-stack';
          }

          if (id.includes('node_modules/dexie')) {
            return 'storage-stack';
          }

          if (id.includes('node_modules/svelte')) {
            return 'vendor-svelte';
          }
        }
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.ts']
  }
});
