import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 상대 경로로 빌드해 GitHub Pages의 하위 경로에서도 그대로 동작하게 한다.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '추세 다이어트',
        short_name: '추세',
        description: '체중 추세로 목표 칼로리를 맞춰 주는 개인용 다이어트 기록 앱',
        lang: 'ko',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        theme_color: '#0f766e',
        background_color: '#f6f7f5',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
