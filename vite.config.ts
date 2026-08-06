import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/logbook/', // GitHub Pages base path
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      strategies: 'StaleWhileRevalidate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'favicon.svg', 'icons.svg'],
      manifest: {
        name: 'LogBook Premium',
        short_name: 'LogBook',
        description: "L'app definitiva per il tracciamento di allenamento, nutrizione e progressi. Funziona anche offline in palestra.",
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/logbook/',
        lang: 'it-IT',
        categories: ['fitness', 'health', 'lifestyle'],
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
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/zustand') || id.includes('node_modules/lucide-react')) return 'vendor';
        }
      }
    }
  }
})
