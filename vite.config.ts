import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 상대 경로로 빌드해 GitHub Pages의 하위 경로에서도 그대로 동작하게 한다.
  base: './',
  // 설정 화면에 보여 줄 빌드 시각. 지금 어떤 버전이 떠 있는지 확인하는 용도다.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // 음식 DB(food-db.json)도 미리 받아 두어 오프라인에서 검색할 수 있게 한다.
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}', '**/*latin-wght-normal*.woff2'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '추세 다이어트',
        short_name: '추세',
        description: '체중 추세로 목표 칼로리를 맞춰 주는 개인용 다이어트 기록 앱',
        lang: 'ko',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        theme_color: '#1c1e4b',
        background_color: '#f5f5fa',
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
    // 테스트는 실제 서버에 붙지 않는다. .env.local이 있어도 계정 기능을 끈 상태로 돌린다.
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
})
