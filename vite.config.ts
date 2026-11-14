/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from '@unplugin-pwa/vite'
import { visualizer } from 'rollup-plugin-visualizer'

// Cloudflare serves the public development frontend on thelogbook.me.
// Firebase account/data/App Check SDKs remain until their replacements are verified.

const appVersion = process.env.npm_package_version || '0.0.0-dev'
const buildSha = process.env.LOGBOOK_BUILD_SHA || process.env.EXPECTED_SHA || process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || 'dev'
const buildHash = buildSha.slice(0, 7)
const buildTime = new Date().toISOString()

// Only Firebase's account/data/App Check SDKs belong in the client. Reject
// Firebase analytics/monitoring (including compat entry points) and OpenTelemetry
// instrumentation/exporters in every emitted chunk, including lazy-loaded ones.
const forbiddenDiagnosticModule = /(?:^|\/)node_modules\/(?:(?:@firebase\/|firebase\/(?:compat\/)?)(?:analytics|crashlytics|performance)(?:-compat)?(?:\/|$)|@opentelemetry\/(?!api(?:\/|$))[^/]+(?:\/|$))/i;

export function assertNoBundledClientDiagnostics(moduleIds: Iterable<string>): void {
  for (const id of moduleIds) {
    const normalized = id.replaceAll('\\', '/');
    if (forbiddenDiagnosticModule.test(normalized)) {
      throw new Error(`External client error monitoring module forbidden in production bundle: ${normalized}`);
    }
  }
}

const basePath = '/'
const cloudflareOrigin = process.env.CLOUDFLARE_APP_ORIGIN;
if (cloudflareOrigin) {
  const url = new URL(cloudflareOrigin);
  if (url.protocol !== 'https:' || url.origin !== cloudflareOrigin ||
      url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('CLOUDFLARE_APP_ORIGIN must be an exact HTTPS origin without a path');
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_HASH__: JSON.stringify(buildHash),
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },

  base: basePath,
  plugins: [
    react(),
    // Update canonical metadata before the Service Worker hashes index.html.
    cloudflareOrigin ? {
      name: 'thelogbook-cloudflare-canonical-origin',
      transformIndexHtml(html) {
        return html.replaceAll('https://thelogbook.web.app/', cloudflareOrigin + '/');
      },
    } : false,
    {
      name: 'thelogbook-no-client-error-monitoring',
      generateBundle(_output, bundle) {
        const modules = Object.values(bundle).flatMap(entry =>
          entry.type === 'chunk' ? Object.keys(entry.modules) : [],
        );
        assertNoBundledClientDiagnostics(modules);
      },
    },
    VitePWA({
      strategies: 'buildSW',
      filename: 'sw.js',
      swType: 'classic',
      registerType: 'prompt',
      // Manifest icon URLs include ?v, so avoid resolving them as disk paths.
      // The image files are already covered by the dist precache glob.
      includeManifestIcons: false,
      includeManifestShortcutIcons: false,
      maximumFileSizeToCacheInBytes: 3000000,
      buildSW: {
        swSrc: 'src/sw.ts',
        // The web manifest is added separately by the PWA plugin.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        globIgnores: ['social-share.png'],
      },
      manifest: {
        id: basePath,
        name: 'TheLogBook',
        short_name: 'TheLogBook',
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
            icons: [{ src: "icon-192.png?v=20261006-vector-master", sizes: "192x192", type: "image/png" }]
          },
          {
            name: "Alimentazione",
            short_name: "Alimentazione",
            description: "Vai alla sezione nutrizione",
            url: "/?tab=nutrition",
            icons: [{ src: "icon-192.png?v=20261006-vector-master", sizes: "192x192", type: "image/png" }]
          }
        ],
        icons: [
          {
            src: 'icon-192.png?v=20261006-vector-master',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png?v=20261006-vector-master',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icon.svg?v=20261006-vector-master',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'icon-maskable-512.png?v=20261006-vector-master',
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
    modulePreload: false,
    sourcemap: false,
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
