import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import type { CoachContext } from '../ai/contract'
import { useAi } from '../ai/store'
import { useAiAvailability } from '../ai/useAiAvailability'
import { AiConflictHint, AiDisclaimer, AiLimitNote, AiQuotaLeft, AiTag } from '../components/ai/AiBits'
import { isRetryable } from '../components/ai/CoachCall'
import { useCoachContext } from '../components/ai/CoachHooks'
import { MAX_QUESTION, useCoach } from '../components/ai/CoachStore'
import { today } from '../lib/date'
import { useSync } from '../sync/store'
import './Coach.css'

/** 글자 수는 한도에 가까워졌을 때만 보여 준다. */
const COUNTER_FROM = 450

const ABOUT = '코치는 내 체중과 식사 기록, 지금 계획을 보고 궁금한 점에 답해 주는 AI예요.'

/** 처음 화면에 보여 주는 질문 예시. 지금 단계에 맞는 것만 보여 준다. */
function starters(phase: CoachContext['phase']): string[] {
  return [
    '체중이 며칠째 그대로인데 왜 그럴까요?',
    '이번 주에 회식이 있는데 어떻게 하면 좋을까요?',
    phase === 'maintain' ? '유지 기간에는 어떻게 먹는 게 좋을까요?' : '지금 감량 속도가 저한테 맞는 걸까요?',
    '어제 많이 먹었는데 괜찮을까요?',
  ]
}

/** 손가락으로 쓰는 기기인지. 그런 기기의 화면 키보드에서는 Enter가 줄바꿈이어야 한다. */
function isCoarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

export default function Coach() {
  const ai = useAiAvailability()
  const checked = useAi((s) => s.checked)
  const forbidden = useAi((s) => s.forbidden)
  const sessionKnown = useSync((s) => s.ready)
  // 이 화면을 쓰던 중에 서버가 '이 계정은 쓸 수 없다'고 답했는지 보려고, 쓸 수 있었던 적이 있는지 기억한다.
  const [wasUsable, setWasUsable] = useState(false)
  if (ai !== 'off' && !wasUsable) setWasUsable(true)

  if (ai === 'off') {
    // 대화하던 중에 막혔으면 말없이 홈으로 보내지 않고, 이 자리에서 한 번 알린다.
    // 다른 화면에 다녀오면 처음부터 막힌 것과 같아 홈으로 보낸다.
    if (forbidden && wasUsable) {
      return (
        <main className="page">
          <h1 className="page-title">코치</h1>
          <p role="alert">이 계정은 AI 기능을 쓸 수 없어요.</p>
          <Link className="btn btn--primary btn--block btn--lg" to="/">
            오늘 화면으로 가기
          </Link>
        </main>
      )
    }
    // 준비 여부나 로그인 상태를 아직 확인하는 중이면 기다리고, 준비되지 않은 게 확실하면 홈으로 보낸다.
    if (checked && sessionKnown) return <Navigate to="/" replace />
    return (
      <main className="page">
        <h1 className="page-title">코치</h1>
        <p className="muted">불러오는 중…</p>
      </main>
    )
  }

  if (ai === 'login') {
    return (
      <main className="page">
        <h1 className="page-title">코치</h1>
        <p>{ABOUT} 로그인하면 코치에게 궁금한 것을 물어볼 수 있어요.</p>
        <Link className="btn btn--primary btn--block btn--lg" to="/settings">
          설정에서 로그인
        </Link>
      </main>
    )
  }

  if (ai === 'conflict') {
    return (
      <main className="page">
        <h1 className="page-title">코치</h1>
        <p>{ABOUT}</p>
        <AiConflictHint />
      </main>
    )
  }

  // 오늘 횟수를 다 써도 나눈 대화는 그대로 읽을 수 있다. 보내기만 막는다.
  return <CoachChat limited={ai === 'limit'} />
}

function CoachChat({ limited }: { limited: boolean }) {
  const asOf = today()
  const context = useCoachContext(asOf)
  const messages = useCoach((s) => s.messages)
  const draft = useCoach((s) => s.draft)
  const pending = useCoach((s) => s.pending)
  const error = useCoach((s) => s.error)
  const setDraft = useCoach((s) => s.setDraft)
  const [confirming, setConfirming] = useState(false)
  const [coarse] = useState(isCoarsePointer)
  const pageRef = useRef<HTMLElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const clearRef = useRef<HTMLButtonElement>(null)
  const lastRef = useRef<HTMLLIElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const last = messages[messages.length - 1]
  const unanswered = last?.role === 'user'
  // 횟수를 다 썼을 때는 횟수 안내만 보여 준다. 앞서 남은 실패 안내를 대화에 두지 않는다.
  const shownError = limited ? null : error

  // 새 말이 생기면 입력창에 가리지 않게 보여 준다.
  // 짧은 말은 대화의 끝(안내 문구까지)이 입력창 바로 위에 오게 하고,
  // 화면보다 긴 답은 끝이 아니라 답의 첫 줄부터 읽을 수 있게 한다.
  useEffect(() => {
    if (messages.length === 0) return
    const composer = composerRef.current
    if (composer) pageRef.current?.style.setProperty('--coach-composer-h', `${composer.offsetHeight}px`)
    const answer = last?.role === 'assistant' ? lastRef.current : null
    const room = composer?.getBoundingClientRect().top ?? 0
    if (answer && room > 0 && answer.offsetHeight > room - 16) {
      answer.scrollIntoView?.({ block: 'start' })
      return
    }
    // jsdom에는 scrollIntoView가 없다.
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length, last, pending, shownError])

  if (!context) {
    return (
      <main className="page">
        <h1 className="page-title">코치</h1>
        <p>아직 계획이 없어서 코치가 볼 기록이 없어요. 먼저 기본 정보를 입력해 주세요.</p>
        <Link className="btn btn--primary btn--block btn--lg" to="/">
          오늘 화면으로 가기
        </Link>
      </main>
    )
  }
  const ctx = context

  const cannotSend = pending || limited || draft.trim() === ''

  function submit() {
    if (limited) return
    // 기다리는 중이거나 빈 글이면 저장소가 받아들이지 않는다.
    useCoach.getState().send(ctx, draft)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중의 Enter는 글자를 확정하는 것이므로 보내지 않는다.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    // 화면 키보드에서는 Enter가 줄바꿈이고, 보내기는 버튼으로만 한다.
    if (isCoarsePointer()) return
    e.preventDefault()
    submit()
  }

  /** 예시 질문은 바로 보내지 않고 입력 칸에 넣기만 한다. 누르는 것만으로 횟수를 쓰지 않게 하려는 것. */
  function pickStarter(q: string) {
    // 이미 적어 둔 글이 있으면 덮어쓰지 않고 다음 줄에 덧붙인다.
    setDraft(draft.trim() === '' ? q : `${draft.replace(/\s+$/, '')}\n${q}`)
    inputRef.current?.focus()
  }

  function toggleConfirm() {
    // 답을 기다리는 중에 지우면 돈을 들인 답이 말없이 버려진다.
    if (pending) return
    setConfirming((v) => !v)
  }

  function cancelClear() {
    setConfirming(false)
    // 이 버튼은 disabled가 아니라 aria-disabled로만 막으므로 언제든 초점을 받을 수 있다.
    clearRef.current?.focus()
  }

  function confirmClear() {
    if (pending) return
    useCoach.getState().clear()
    setConfirming(false)
    // 횟수를 다 써서 입력 칸이 막혀 있으면 초점이 사라지지 않게 제목으로 보낸다.
    ;(limited ? titleRef : inputRef).current?.focus()
  }

  return (
    <main className="page coach-page" ref={pageRef}>
      <header className="coach-head">
        <h1 className="page-title" ref={titleRef} tabIndex={-1}>
          코치
        </h1>
        {messages.length > 0 && (
          <button
            type="button"
            ref={clearRef}
            className="btn btn--ghost coach-new"
            aria-expanded={confirming}
            // 초점을 잃지 않게 disabled 대신 aria-disabled로 막고, 누르는 쪽에서 한 번 더 막는다.
            aria-disabled={pending}
            onClick={toggleConfirm}
          >
            대화 지우기
          </button>
        )}
      </header>
      {messages.length > 0 && <p className="small muted coach-keep">대화는 앱을 새로 열면 지워져요.</p>}

      {confirming && messages.length > 0 && (
        <div className="coach-confirm" role="group" aria-labelledby="coach-confirm-q">
          <p id="coach-confirm-q">대화를 지우고 새로 시작할까요?</p>
          <div className="coach-confirm-actions">
            <button type="button" className="btn" autoFocus onClick={cancelClear}>
              취소
            </button>
            <button type="button" className="btn btn--danger" aria-disabled={pending} onClick={confirmClear}>
              지우기
            </button>
          </div>
        </div>
      )}

      <div className="coach-body">
        {messages.length === 0 && (
          <div className="coach-intro">
            <p>코치는 내 기본 정보와 최근 2주의 체중·식사 기록, 지금 계획을 AI에 보내 답을 받아요.</p>
            {/* 횟수를 다 썼으면 오늘은 보낼 수 없으니 예시 질문도 권하지 않는다. */}
            {!limited && (
              <div className="coach-starters-block">
                <p className="small muted" id="coach-starters-caption">
                  이런 걸 물어볼 수 있어요. 누르면 입력 칸에 들어가요.
                </p>
                <ul className="coach-starters" aria-labelledby="coach-starters-caption">
                  {starters(ctx.phase).map((q) => (
                    <li key={q}>
                      <button type="button" className="coach-starter" onClick={() => pickStarter(q)}>
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 대화 자리는 늘 그려 둔다. 그래야 첫 답도 화면 낭독기가 읽는다. 안에는 따로 알리는 역할을 두지 않는다. */}
        <div className="coach-log" role="log" aria-live="polite" aria-label="대화">
          {messages.length > 0 && (
            <ol className="coach-thread">
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <li key={m.id} className="coach-msg coach-msg--user" data-testid="coach-msg-user">
                    <span className="coach-sr">나</span>
                    <p className="coach-text">{m.text}</p>
                  </li>
                ) : (
                  <li
                    key={m.id}
                    ref={i === messages.length - 1 ? lastRef : undefined}
                    className="coach-msg coach-msg--coach"
                    data-testid="coach-msg-coach"
                  >
                    <span className="coach-who">
                      <AiTag /> 코치
                    </span>
                    <p className="coach-text">{m.text}</p>
                  </li>
                ),
              )}
              {unanswered && (pending || shownError !== null) && (
                <li className="coach-msg coach-msg--coach" data-testid="coach-msg-wait">
                  <span className="coach-who">
                    <AiTag /> 코치
                  </span>
                  {pending ? (
                    <p className="ai-loading">
                      <span className="ai-loading-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                      답을 쓰는 중이에요
                    </p>
                  ) : shownError !== null ? (
                    <div className="ai-error">
                      <p>{shownError.message}</p>
                      {shownError.code === 'unauthorized' && (
                        <Link className="btn" to="/settings">
                          설정에서 로그인
                        </Link>
                      )}
                      {isRetryable(shownError) && (
                        <button type="button" className="btn" onClick={() => useCoach.getState().retry(ctx)}>
                          다시 시도
                        </button>
                      )}
                    </div>
                  ) : null}
                </li>
              )}
            </ol>
          )}
        </div>

        <AiDisclaimer>
          코치의 답은 기록을 바탕으로 한 참고용이고 의학적 조언이 아니에요. 건강이 걱정되면 전문가와 상의해 주세요.
        </AiDisclaimer>
        <div ref={endRef} className="coach-end" aria-hidden="true" />
      </div>

      <form className="coach-composer" ref={composerRef} onSubmit={onSubmit}>
        <div className="coach-composer-row">
          <label className="coach-sr" htmlFor="coach-input">
            코치에게 물어볼 내용
          </label>
          <textarea
            id="coach-input"
            ref={inputRef}
            className="coach-input"
            rows={1}
            value={draft}
            maxLength={MAX_QUESTION}
            placeholder={limited ? '내일 다시 물어볼 수 있어요' : '궁금한 것을 적어 주세요'}
            disabled={limited}
            enterKeyHint={coarse ? 'enter' : 'send'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {/* 보낸 직후에도 초점을 잃지 않게 disabled 대신 aria-disabled로 막는다. 보내는 쪽과 저장소가 한 번 더 막는다. */}
          <button type="submit" className="btn btn--primary coach-send" aria-disabled={cannotSend}>
            보내기
          </button>
        </div>
        <div className="coach-meta" data-testid="coach-meta">
          {limited ? <AiLimitNote /> : <AiQuotaLeft />}
          {draft.length >= COUNTER_FROM && (
            <span className="coach-counter small muted num" data-testid="coach-counter">
              {draft.length}/{MAX_QUESTION}
            </span>
          )}
        </div>
      </form>
    </main>
  )
}
