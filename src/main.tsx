import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 공통 스타일을 화면별 스타일(App이 불러옴)보다 먼저 불러와, 화면 쪽 규칙이 이기게 한다.
import '@fontsource-variable/bricolage-grotesque/wght.css'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'

// 새 버전이 배포되면 받아서 바로 화면을 새로 띄운다. 이렇게 하지 않으면 한 번 더 열 때까지 이전 화면이 보인다.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    // 앱을 오래 켜 두는 경우를 위해, 앱으로 돌아올 때마다 새 버전이 있는지 확인한다.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration?.update()
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
