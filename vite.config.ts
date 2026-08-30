/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'

// Base path: set to '/' for Vercel or root domains.

const appVersion = process.env.npm_package_version || '0.0.0-dev'
const buildHash = (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7)
const buildTime = new Date().toISOString()

const basePath = '/'

export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        'src/lib/merge.ts': { branches: 90, functions: 90, lines: 90 },
        'src/lib/schema.ts': { branches: 90, functions: 90, lines: 90 }
      }
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_HASH__: JSON.stringify(buildHash),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },

  base: basePath,
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'favicon.svg', 'icons.svg'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3000000
      },
      manifest: {
        id: basePath,
        name: 'LogBook Premium',
        short_name: 'LogBook',
        description: "L'app definitiva per il tracciamento di allenamento, nutrizione e progressi. Funziona anche offline in palestra.",
        theme_color: '#000000',
        background_color: '#000000',
        display_override: ['window-controls-overlay', 'standalone'],
        display: 'standalone',
        orientation: 'portrait',
        start_url: basePath,
        scope: basePath,
        lang: 'it-IT',
        categories: ['fitness', 'health', 'lifestyle'],
        shortcuts: [
          {
            name: "Allenamento",
            short_name: "Allenamento",
            description: "Vai alla sezione allenamento",
            url: "/?tab=training",
            icons: [{ src: "icon-192.png", sizes: "192x192" }]
          },
          {
            name: "Alimentazione",
            short_name: "Alimentazione",
            description: "Vai alla sezione nutrizione",
            url: "/?tab=nutrition",
            icons: [{ src: "icon-192.png", sizes: "192x192" }]
          }
        ],
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'apple-touch-icon.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    }),
    process.env.npm_lifecycle_event === 'analyze' && visualizer({
      open: true,
      filename: 'bundle-stats.html',
      gzipSize: true,
      brotliSize: true
    })
  ],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase/auth')) return 'firebase-auth';
          if (id.includes('node_modules/firebase/firestore')) return 'firebase-firestore';
          if (id.includes('node_modules/firebase')) return 'firebase-core';
          if (id.includes('chart.js') || id.includes('react-chartjs-2')) return 'chartjs';
          if (id.includes('node_modules/zod')) return 'vendor-zod';
          if (id.includes('node_modules/date-fns')) return 'vendor-dates';
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/zustand') || id.includes('node_modules/lucide-react')) return 'vendor';
        }
      }
    }
  }
})
