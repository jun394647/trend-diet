import { Link } from 'react-router-dom'
import type { AiError } from '../../ai/client'
import { useAiQuotaLeft } from '../../ai/store'
import './AiBits.css'

/** AI가 만든 내용임을 알리는 작은 표시. */
export function AiTag() {
  return <span className="ai-tag">AI</span>
}

/** 응답을 기다리는 동안 보여 준다. label은 '칼로리를 어림잡는 중이에요'처럼 지금 하는 일을 적는다. */
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
          설정에서 로그인
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

/**
 * 로그인하지 않아 AI 기능을 쓸 수 없을 때의 안내.
 * benefit은 '사진이나 말로 적은 식사를 AI가 어림잡아 줘요'처럼 로그인하면 되는 일을 한 문장으로 적는다(마침표 없이).
 * what은 예전 방식('사진으로 기록하기'처럼 하려던 일)이고, benefit이 없을 때만 쓴다.
 */
export function AiLoginHint({ benefit, what }: { benefit?: string; what?: string }) {
  return (
    <p className="ai-login small muted">
      {benefit ? `로그인하면 ${benefit}.` : what ? `${what}는 로그인하면 쓸 수 있어요.` : '로그인하면 AI 기능을 쓸 수 있어요.'}{' '}
      <Link to="/settings">설정에서 로그인</Link>
    </p>
  )
}

/** 로그인은 했지만 기록을 어떻게 합칠지 정하지 않아 AI를 쓸 수 없을 때의 안내. */
export function AiConflictHint() {
  return (
    <p className="ai-login small muted">
      기록을 어떻게 할지 정하면 AI를 쓸 수 있어요. <Link to="/settings">설정에서 정하기</Link>
    </p>
  )
}

/** 오늘 횟수를 다 썼을 때의 한 줄. fallback에는 AI 없이 할 수 있는 일을 한 문장으로 적는다. */
export function AiLimitNote({ fallback }: { fallback?: string }) {
  return (
    <p className="ai-limit small muted">
      오늘 AI 횟수를 다 썼어요. 내일 다시 쓸 수 있어요.{fallback ? ` ${fallback}` : ''}
    </p>
  )
}

/** 오늘 남은 횟수. 알고 있고 10번 이하로 남았을 때만 보여 준다. 다 썼을 때는 AiLimitNote가 대신 말한다. */
export function AiQuotaLeft() {
  const left = useAiQuotaLeft()
  if (left === null || left > 10 || left <= 0) return null
  return <p className="ai-quota small muted">오늘 {left}번 남았어요</p>
}

/** AI 추정치에 항상 붙이는 한 줄. */
export function AiDisclaimer({ children }: { children?: string }) {
  return <p className="ai-disclaimer small muted">{children ?? 'AI가 어림잡은 값이라 실제와 다를 수 있어요.'}</p>
}
