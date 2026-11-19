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
        // 어떤 주소로 열어도 앱 화면으로 이어지되, 서버 API 주소는 서비스 워커가 건드리지 않는다.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // 한글 글꼴은 조각이 많아 미리 받지 않고, 한 번 쓰인 조각만 기기에 남겨 오프라인에서도 쓴다.
        // 처음 방문에서 받은 조각은 src/pwa/fonts.ts가 같은 저장소('fonts')에 넣어 준다.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/assets/') && url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 365 },
              // 글꼴 요청에는 Origin 헤더가 붙는다. 서버가 Vary: Origin을 보내도 저장해 둔 조각을 찾을 수 있게 한다.
              matchOptions: { ignoreVary: true },
            },
          },
        ],
      },
      // public/의 아이콘은 위 globPatterns로 이미 미리 받는다. 같은 파일을 두 번 적지 않게 자동 추가는 끈다.
      includeAssets: [],
      includeManifestIcons: false,
      manifest: {
        // 설치된 앱을 가리키는 고정 이름. start_url을 바꿔도 같은 앱으로 남는다.
        id: './',
        name: '추세 다이어트',
        short_name: '추세',
        description: '체중 추세로 목표 칼로리를 맞춰 주는 개인용 다이어트 기록 앱',
        lang: 'ko',
        dir: 'ltr',
        categories: ['health', 'lifestyle'],
        display: 'standalone',
        orientation: 'portrait',
        // 매니페스트 파일이 있는 자리 기준이라, 도메인 루트(Vercel)에서도 하위 경로에서도 맞는다.
        start_url: './',
        scope: './',
        // 앱을 여는 동안과 앱 전환 화면에서 쓰는 색. 밝은 테마의 바탕과 같다(어두운 테마는 index.html의 theme-color가 맡는다).
        theme_color: '#f5f5fa',
        background_color: '#f5f5fa',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'monochrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
        ],
        // 아이콘을 길게 눌러 바로 가는 동작. 주소의 action 값은 src/pwa/launchAction.ts가 읽는다.
        shortcuts: [
          {
            name: '식사 추가',
            short_name: '식사 추가',
            description: '오늘 먹은 것을 바로 적어요',
            url: './#/?action=add-meal',
            icons: [{ src: 'shortcut-meal.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: '체중 기록',
            short_name: '체중 기록',
            description: '오늘 체중을 바로 적어요',
            url: './#/?action=weight',
            icons: [{ src: 'shortcut-weight.png', sizes: '192x192', type: 'image/png' }],
          },
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
