import { useEffect } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import Checkin from './pages/Checkin'
import Onboarding from './pages/Onboarding'
import Settings from './pages/Settings'
import Today from './pages/Today'
import Trend from './pages/Trend'
import { useStore } from './store'
import { useAi } from './ai/store'
import { useSync } from './sync/store'

function TabBar() {
  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      <div className="tabbar-inner">
        <NavLink to="/" end>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="5" width="16" height="15" rx="2" />
            <path d="M8 3v4M16 3v4M4 10h16" />
          </svg>
          오늘
        </NavLink>
        <NavLink to="/trend">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7l5 4 4-2 7 8" />
            <path d="M4 20h16" />
          </svg>
          추세
        </NavLink>
        <NavLink to="/settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="8" cy="17" r="2" />
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

  if (!ready) return <div className="center-screen">불러오는 중…</div>

  return (
    <HashRouter>
      <div className="app">
        {hasProfile ? (
          <>
            <Routes>
              <Route path="/" element={<Today />} />
              <Route path="/trend" element={<Trend />} />
              <Route path="/checkin" element={<Checkin />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <TabBar />
          </>
        ) : (
          <Onboarding />
        )}
      </div>
    </HashRouter>
  )
}
