import { Link } from 'react-router-dom'
import type { AiError } from '../../ai/client'
import './AiBits.css'

/** AI가 만든 내용임을 알리는 작은 표시. */
export function AiTag() {
  return <span className="ai-tag">AI</span>
}

/** 응답을 기다리는 동안 보여 준다. label은 '칼로리를 계산하는 중이에요'처럼 지금 하는 일을 적는다. */
export function AiLoading({ label }: { label: string }) {
  return (
    <p className="ai-loading" role="status">
      <span className="ai-loading-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {label}
    </p>
  )
}

/** 실패 안내. 다시 해 볼 만한 실패면 onRetry를 넘겨 버튼을 보여 준다. */
export function AiErrorNote({ error, onRetry }: { error: AiError; onRetry?: () => void }) {
  const retryable = error.code === 'busy' || error.code === 'failed' || error.code === 'offline'
  return (
    <div className="ai-error" role="alert">
      <p>{error.message}</p>
      {error.code === 'unauthorized' && (
        <Link className="btn" to="/settings">
          로그인하러 가기
        </Link>
      )}
      {retryable && onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}

/** 로그인하지 않아 AI 기능을 쓸 수 없을 때의 안내. what은 '사진으로 기록하기'처럼 하려던 일. */
export function AiLoginHint({ what }: { what: string }) {
  return (
    <p className="ai-login small muted">
      {what}는 로그인하면 쓸 수 있어요. <Link to="/settings">설정에서 로그인</Link>
    </p>
  )
}

/** AI 추정치에 항상 붙이는 한 줄. */
export function AiDisclaimer({ children }: { children?: string }) {
  return <p className="ai-disclaimer small muted">{children ?? 'AI가 어림잡은 값이라 실제와 다를 수 있어요.'}</p>
}
