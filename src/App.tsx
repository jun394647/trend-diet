import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAiAvailability } from './ai/useAiAvailability'
import Checkin from './pages/Checkin'
import Coach from './pages/Coach'
import Onboarding from './pages/Onboarding'
import Settings from './pages/Settings'
import Today from './pages/Today'
import Trend from './pages/Trend'
import { useStore } from './store'
import { useAi } from './ai/store'
import { useSync } from './sync/store'
import Splash from './components/Splash'
import ToastRegion from './components/Toast'
import { startPwaFeedback } from './pwa/feedback'

const ICON = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

function TabBar() {
  // AI 기능이 준비되지 않았으면 코치 탭은 아예 보이지 않는다.
  const showCoach = useAiAvailability() !== 'off'
  const { pathname } = useLocation()
  const paths = ['/', '/trend', ...(showCoach ? ['/coach'] : []), '/settings']
  // 지금 탭 뒤에 깔리는 알약 모양 표시가 탭 사이를 미끄러져 움직인다. 탭에 속하지 않는 화면에서는 숨긴다.
  const active = paths.indexOf(pathname)
  const pillStyle = { '--tab-count': paths.length, '--tab-index': Math.max(active, 0) } as CSSProperties
  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      <div className="tabbar-inner" style={pillStyle}>
        <span className="tabbar-pill" data-hidden={active < 0 || undefined} aria-hidden="true" />
        <NavLink to="/" end>
          <svg {...ICON}>
            <rect x="4" y="5" width="16" height="15" rx="3" />
            <path d="M8 3v3.5M16 3v3.5M4 10h16" />
            <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
          </svg>
          오늘
        </NavLink>
        <NavLink to="/trend">
          <svg {...ICON}>
            <path d="M4 5v13a2 2 0 0 0 2 2h14" />
            <path d="M8 8.5l3.2 3 3-1.2 3.3 3.6" />
            <circle cx="18.2" cy="14.7" r="1.4" fill="currentColor" stroke="none" />
          </svg>
          추세
        </NavLink>
        {showCoach && (
          <NavLink to="/coach">
            <svg {...ICON}>
              <path d="M7 5h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-4.5L8 20.5V17H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z" />
              <path d="M8.5 9.5h7M8.5 12.5h4" />
            </svg>
            코치
          </NavLink>
        )}
        <NavLink to="/settings">
          <svg {...ICON}>
            <path d="M4 8h8M17.5 8H20M4 16h2.5M12 16h8" />
            <circle cx="14.75" cy="8" r="2.5" />
            <circle cx="9.25" cy="16" r="2.5" />
          </svg>
          설정
        </NavLink>
      </div>
    </nav>
  )
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const hasProfile = useStore((s) => s.profile !== null)
  const init = useStore((s) => s.init)

  useEffect(() => {
    // 기기 기록을 먼저 읽고, 그다음 계정 동기화를 시작한다.
    void init().then(() => useSync.getState().start())
    void useAi.getState().check()
  }, [init])

  // 자동 업데이트 직후와 연결이 끊기거나 돌아올 때 알림으로 알려 준다.
  useEffect(() => startPwaFeedback(), [])

  // index.html에 미리 그려 둔 스플래시와 똑같은 화면이라, 기록을 읽는 동안 깜빡임 없이 이어진다.
  if (!ready) return <Splash />

  return (
    <HashRouter>
      <div className="app">
        {hasProfile ? (
          <>
            <Routes>
              <Route path="/" element={<Today />} />
              <Route path="/trend" element={<Trend />} />
              <Route path="/checkin" element={<Checkin />} />
              <Route path="/coach" element={<Coach />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <TabBar />
          </>
        ) : (
          <Onboarding />
        )}
      </div>
      <ToastRegion />
    </HashRouter>
  )
}
