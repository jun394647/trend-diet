import { useEffect, useState } from 'react'
import { HINT_MIN_DAYS, dismissHint, initInstall, isHintDismissed, promptInstall, usageDayCount, useInstallMode } from '../pwa/install'
import InstallGuide from './InstallGuide'
import { BrandMark } from './Splash'
import './Install.css'

/**
 * 오늘 화면에 한 번만 뜨는 설치 제안.
 * 서로 다른 날 두 번 이상 쓴 사람에게만, 설치할 수 있는 기기에서만 보인다.
 * 닫거나 설치를 눌러 보면 다시는 뜨지 않는다(설정의 InstallEntry는 그대로 남는다).
 * props 없이 `<InstallHint />`로 쓴다.
 */
export default function InstallHint() {
  const mode = useInstallMode()
  // 처음 그릴 때의 조건으로 정한다. 쓰는 도중에 갑자기 나타나지 않는다.
  const [eligible] = useState(() => usageDayCount() >= HINT_MIN_DAYS && !isHintDismissed())
  const [closed, setClosed] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  useEffect(() => initInstall(), [])

  const close = () => {
    dismissHint()
    setClosed(true)
  }

  if (guideOpen) {
    return (
      <InstallGuide
        onClose={() => {
          setGuideOpen(false)
          close()
        }}
      />
    )
  }
  if (!eligible || closed || mode === 'installed' || mode === 'none') return null

  const install = () => {
    if (mode === 'ios') {
      setGuideOpen(true)
      return
    }
    // 설치 창에서 무엇을 고르든 제안은 한 번으로 끝낸다.
    void promptInstall().finally(close)
  }

  return (
    <aside className="install-hint" aria-label="앱 설치 제안">
      <BrandMark className="install-hint-mark" />
      <p className="install-hint-text">
        <strong>홈 화면에 설치</strong>
        <span className="muted small">앱처럼 바로 열려요</span>
      </p>
      <button
        type="button"
        className="btn install-hint-action"
        aria-label={mode === 'ios' ? '홈 화면에 추가하는 방법 보기' : '홈 화면에 설치하기'}
        onClick={install}
      >
        {mode === 'ios' ? '방법 보기' : '설치'}
      </button>
      <button type="button" className="install-hint-close" aria-label="설치 제안 닫기" onClick={close}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      </button>
    </aside>
  )
}
