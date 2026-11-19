import { useEffect, useState } from 'react'
import { initInstall, promptInstall, useInstallMode } from '../pwa/install'
import InstallGuide from './InstallGuide'
import './Install.css'

/**
 * 설정 화면에 두는 "홈 화면에 설치" 구획. 언제든 여기서 설치할 수 있다.
 * 설치할 수 없는 브라우저이거나 이미 홈 화면 앱으로 열려 있으면 아무것도 그리지 않는다.
 * props 없이 `<InstallEntry />`로 쓴다.
 */
export default function InstallEntry() {
  const mode = useInstallMode()
  const [guideOpen, setGuideOpen] = useState(false)
  useEffect(() => initInstall(), [])

  if (mode === 'installed' || mode === 'none') return null

  return (
    <section className="card install-entry" aria-labelledby="install-entry-title">
      <div className="install-entry-text">
        <h2 className="install-entry-title" id="install-entry-title">
          홈 화면에 설치
        </h2>
        <p className="muted small">주소창 없이 바로 열리고, 인터넷이 끊겨도 기록할 수 있어요.</p>
      </div>
      {mode === 'prompt' ? (
        <button type="button" className="btn" aria-label="홈 화면에 설치하기" onClick={() => void promptInstall()}>
          설치
        </button>
      ) : (
        <button type="button" className="btn" aria-label="홈 화면에 추가하는 방법 보기" onClick={() => setGuideOpen(true)}>
          방법 보기
        </button>
      )}
      {guideOpen && <InstallGuide onClose={() => setGuideOpen(false)} />}
    </section>
  )
}
