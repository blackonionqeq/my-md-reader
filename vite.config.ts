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
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        theme_color: '#f8fafc',
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
        ],
        file_handlers: [
          {
            action: '/',
            accept: {
              'text/markdown': ['.md']
            }
          }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: /mermaid.*\.(?:js|mjs)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mermaid-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 }
            }
          }
        ],
      }
    })
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'markdown-stack',
              test: /node_modules[\\/](markdown-it|dompurify)[\\/]/
            },
            {
              name: 'highlight-stack',
              test: /node_modules[\\/]highlight\.js[\\/]/
            },
            {
              name: 'storage-stack',
              test: /node_modules[\\/]dexie[\\/]/
            },
            {
              name: 'vendor-svelte',
              test: /node_modules[\\/]svelte[\\/]/
            }
          ]
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
