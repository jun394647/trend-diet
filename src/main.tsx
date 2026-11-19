import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 공통 스타일을 화면별 스타일(App이 불러옴)보다 먼저 불러와, 화면 쪽 규칙이 이기게 한다.
import '@fontsource-variable/bricolage-grotesque/wght.css'
// 한글 본문 글꼴. 글자 묶음별로 나뉜 파일이라 화면에 쓰인 글자만 내려받는다.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'
import { markUpdateReload } from './pwa/feedback'
import { scheduleFontWarmup } from './pwa/fonts'
import { initInstall, recordUsageDay } from './pwa/install'

// 설치 이벤트는 화면이 뜬 직후 한 번만 오므로, 화면을 그리기 전에 받을 준비를 해 둔다.
initInstall()
recordUsageDay()

// 새 버전이 배포되면 받아서 바로 화면을 새로 띄운다. 이렇게 하지 않으면 한 번 더 열 때까지 이전 화면이 보인다.
registerSW({
  immediate: true,
  onNeedReload() {
    // 새로 뜬 화면이 "새 버전으로 바뀌었어요"라고 알릴 수 있게 표시를 남기고 새로 띄운다.
    markUpdateReload()
    window.location.reload()
  },
  onRegisteredSW(_url, registration) {
    // 앱을 오래 켜 두는 경우를 위해, 앱으로 돌아올 때마다 새 버전이 있는지 확인한다.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration?.update()
    })
  },
})

// 처음 방문에서 받은 한글 글꼴 조각도 오프라인 저장소에 넣어 둔다.
scheduleFontWarmup()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
