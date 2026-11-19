import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { isInAppBrowser } from '../pwa/install'
import { BrandMark } from './Splash'
import './Install.css'

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 14.5V3.5M8 7l4-3.5L16 7" />
      <path d="M8.5 10.5H7a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5a2 2 0 0 0-2-2h-1.5" />
    </svg>
  )
}

function AddSquareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  )
}

/**
 * iOS에서 홈 화면에 추가하는 방법을 알려 주는 시트.
 * iOS에는 설치 창을 띄우는 방법이 없어서, 사람이 직접 공유 메뉴에서 골라야 한다.
 */
export default function InstallGuide({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // 열릴 때 포커스를 시트 안으로 옮기고, 닫히면 원래 자리로 돌려준다.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      // 누를 수 있는 것이 닫기 버튼 하나뿐이라, Tab은 그 자리에 머문다.
      if (e.key === 'Tab') {
        e.preventDefault()
        closeRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      opener?.focus()
    }
  }, [])

  // 어느 화면에 놓이든 화면 전체를 덮도록 body 바로 아래에 그린다.
  return createPortal(
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet install-guide" role="dialog" aria-modal="true" aria-labelledby="install-guide-title">
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="install-guide-head">
          <BrandMark className="install-guide-mark" />
          <div>
            <h2 className="install-guide-title" id="install-guide-title">
              홈 화면에 추가하기
            </h2>
            <p className="muted small">주소창 없이 앱처럼 열리고, 인터넷이 끊겨도 기록할 수 있어요.</p>
          </div>
        </div>

        {isInAppBrowser() && (
          <p className="banner banner--warn install-guide-note">지금 화면에서는 추가할 수 없어요. Safari로 연 다음 아래 순서대로 해 주세요.</p>
        )}

        <ol className="install-steps">
          <li>
            <span className="install-step-icon">
              <ShareIcon />
            </span>
            <p>
              <strong>공유 버튼</strong>을 눌러요.
              <span className="install-step-note muted small">안 보이면 주소창 옆 ··· 안에 있어요.</span>
            </p>
          </li>
          <li>
            <span className="install-step-icon">
              <AddSquareIcon />
            </span>
            <p>
              목록을 내려 <strong>홈 화면에 추가</strong>를 골라요.
            </p>
          </li>
          <li>
            <span className="install-step-icon install-step-icon--mark">
              <BrandMark />
            </span>
            <p>
              오른쪽 위 <strong>추가</strong>를 누르면 홈 화면에 생겨요.
            </p>
          </li>
        </ol>

        <button ref={closeRef} type="button" className="btn btn--primary btn--block btn--lg" onClick={onClose}>
          알겠어요
        </button>
      </div>
    </div>,
    document.body,
  )
}
