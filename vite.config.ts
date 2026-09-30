/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Base path stays at the canonical origin root regardless of hosting provider.

const appVersion = process.env.npm_package_version || '0.0.0-dev'
const buildSha =
  process.env.LOGBOOK_BUILD_SHA ||
  // Canonical PR verification exports the exact checked-out candidate here;
  // GITHUB_SHA on pull_request can refer to GitHub's synthetic merge ref.
  process.env.EXPECTED_SHA ||
  process.env.GITHUB_SHA ||
  // Transitional fallback while the legacy Vercel origin remains available.
  process.env.VERCEL_GIT_COMMIT_SHA ||
  'dev'
const deployEnvironment =
  process.env.LOGBOOK_DEPLOY_ENV ||
  // Transitional fallback only; Firebase/GitHub uses LOGBOOK_DEPLOY_ENV.
  process.env.VERCEL_ENV ||
  'development'
const buildHash = buildSha.slice(0, 7)
const sentryBuildEnabled =
  deployEnvironment === 'production' &&
  Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT)
const buildTime = new Date().toISOString()
const publicOrigin = (process.env.VITE_PUBLIC_ORIGIN || 'https://logbook-gnf.vercel.app').replace(/\/$/, '')

const basePath = '/'

const deploymentHtml = () => ({
  name: 'logbook:deployment-html',
  transformIndexHtml(html: string) {
    return html.replaceAll('__LOGBOOK_PUBLIC_ORIGIN__', publicOrigin)
  }
})

// vite-plugin-pwa 1.3.0 still emits Rollup's deprecated inlineDynamicImports
// in its nested Vite 8 service-worker build. Translate it to the equivalent
// Rolldown/Vite 8 option until the upstream plugin ships that migration.
const pwaVite8OutputCompatibility = () => ({
  name: 'logbook:pwa-vite8-output-compatibility',
  config(config: any) {
    const output = config.build?.rollupOptions?.output
    if (!output || Array.isArray(output) || output.inlineDynamicImports === undefined) return
    delete output.inlineDynamicImports
    output.codeSplitting = false
  }
})

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_HASH__: JSON.stringify(buildHash),
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },

  base: basePath,
  plugins: [
    deploymentHtml(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icons.svg'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3000000,
        buildPlugins: {
          vite: [pwaVite8OutputCompatibility()]
        }
      },
      manifest: {
        id: basePath,
        name: 'LogBook',
        short_name: 'LogBook',
        description: "L'app definitiva per il tracciamento di allenamento, nutrizione e progressi. Funziona anche offline in palestra.",
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
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
            icons: [{ src: "icon-192.png?v=20260929-chef", sizes: "192x192", type: "image/png" }]
          },
          {
            name: "Alimentazione",
            short_name: "Alimentazione",
            description: "Vai alla sezione nutrizione",
            url: "/?tab=nutrition",
            icons: [{ src: "icon-192.png?v=20260929-chef", sizes: "192x192", type: "image/png" }]
          }
        ],
        icons: [
          {
            src: 'icon-192.png?v=20260929-chef',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png?v=20260929-chef',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icon-maskable-512.png?v=20260929-chef',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    }),
    sentryBuildEnabled && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      release: {
        name: buildSha,
      },
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
    }),
    process.env.npm_lifecycle_event === 'analyze' && visualizer({
      open: true,
      filename: 'bundle-stats.html',
      gzipSize: true,
      brotliSize: true
    })
  ],
  build: {
    modulePreload: false,
    sourcemap: sentryBuildEnabled ? 'hidden' : false,
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
