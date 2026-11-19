import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import type { AiRequest } from '../ai/contract'
import { useAi } from '../ai/store'
import { useAiAvailability } from '../ai/useAiAvailability'
import { useAiCall } from '../ai/useAiCall'
import { AiDisclaimer, AiErrorNote, AiLoading, AiTag } from '../components/ai/AiBits'
import { useCoachContext } from '../components/ai/CoachHooks'
import { toHistory, useCoach, type CoachMessage } from '../components/ai/CoachStore'
import { today } from '../lib/date'
import './Coach.css'

type AskRequest = Extract<AiRequest, { task: 'ask' }>

const MAX_QUESTION = 500
/** 글자 수는 한도에 가까워졌을 때만 보여 준다. */
const COUNTER_FROM = 450

const STARTERS = [
  '체중이 며칠째 그대로인데 왜 그럴까요?',
  '이번 주에 회식이 있는데 어떻게 하면 좋을까요?',
  '지금 감량 속도가 저한테 맞는 걸까요?',
  '어제 많이 먹었는데 오늘은 어떻게 할까요?',
]

export default function Coach() {
  const ai = useAiAvailability()
  const checked = useAi((s) => s.checked)

  if (ai === 'off') {
    // 준비 여부를 아직 확인하는 중이면 기다리고, 준비되지 않은 게 확실하면 홈으로 보낸다.
    if (checked) return <Navigate to="/" replace />
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
        <p>
          코치는 내 체중과 섭취 기록, 지금 계획을 보고 궁금한 점에 답해 주는 AI예요. 로그인하면 쓸 수 있어요.
        </p>
        <Link className="btn btn--primary btn--block btn--lg" to="/settings">
          설정에서 로그인
        </Link>
      </main>
    )
  }

  return <CoachChat />
}

function CoachChat() {
  const asOf = today()
  const context = useCoachContext(asOf)
  const messages = useCoach((s) => s.messages)
  const add = useCoach((s) => s.add)
  const clear = useCoach((s) => s.clear)
  const usage = useAi((s) => s.usage)
  const { state, run, reset } = useAiCall<AskRequest>()
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const waiting = state.status === 'loading'
  const last: CoachMessage | undefined = messages[messages.length - 1]
  const unanswered = last?.role === 'user'
  const remaining = usage ? Math.max(0, usage.limit - usage.used) : null

  // 새 말이 생기면 맨 아래(입력창 바로 위)가 보이게 한다. jsdom에는 scrollIntoView가 없다.
  useEffect(() => {
    if (messages.length === 0) return
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length, state.status])

  if (!context) {
    return (
      <main className="page">
        <h1 className="page-title">코치</h1>
        <p>아직 계획이 없어서 코치가 볼 기록이 없어요. 먼저 기본 정보를 입력해 주세요.</p>
        <Link className="btn btn--primary btn--block btn--lg" to="/">
          홈으로 가기
        </Link>
      </main>
    )
  }

  async function ask(question: string, prior: CoachMessage[]) {
    if (!context) return
    const result = await run({ task: 'ask', context, question, history: toHistory(prior) })
    if (result) add('assistant', result.answer)
  }

  function send(text: string) {
    const question = text.trim().slice(0, MAX_QUESTION)
    if (!question || waiting) return
    const prior = useCoach.getState().messages
    add('user', question)
    setDraft('')
    void ask(question, prior)
  }

  /** 답을 받지 못한 마지막 질문을 다시 보낸다. 질문을 대화에 또 넣지는 않는다. */
  function retry() {
    const all = useCoach.getState().messages
    const q = all[all.length - 1]
    if (!q || q.role !== 'user' || waiting) return
    void ask(q.text, all.slice(0, -1))
  }

  function startOver() {
    reset()
    clear()
    setDraft('')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(draft)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중의 Enter는 글자를 확정하는 것이므로 보내지 않는다.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    send(draft)
  }

  return (
    <main className="page coach-page">
      <header className="coach-head">
        <h1 className="page-title">코치</h1>
        {messages.length > 0 && (
          <button type="button" className="btn btn--ghost coach-new" onClick={startOver}>
            새 대화
          </button>
        )}
      </header>

      <div className="coach-body">
        {messages.length === 0 ? (
          <div className="coach-intro">
            <p>
              코치는 최근 2주의 체중과 섭취 기록, 지금 계획을 보고 답해요. 궁금한 것을 편하게 물어보세요.
            </p>
            <ul className="coach-starters" aria-label="이런 걸 물어볼 수 있어요">
              {STARTERS.map((q) => (
                <li key={q}>
                  <button type="button" className="coach-starter" onClick={() => send(q)}>
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="coach-thread" aria-label="대화" aria-live="polite">
            {messages.map((m) =>
              m.role === 'user' ? (
                <li key={m.id} className="coach-msg coach-msg--user" data-testid="coach-msg-user">
                  <span className="coach-sr">나</span>
                  <p className="coach-text">{m.text}</p>
                </li>
              ) : (
                <li key={m.id} className="coach-msg coach-msg--coach" data-testid="coach-msg-coach">
                  <span className="coach-who">
                    <AiTag /> 코치
                  </span>
                  <p className="coach-text">{m.text}</p>
                </li>
              ),
            )}
            {(waiting || unanswered) && (
              <li className="coach-msg coach-msg--coach">
                <span className="coach-who">
                  <AiTag /> 코치
                </span>
                {waiting ? (
                  <AiLoading label="답을 쓰는 중이에요" />
                ) : state.status === 'error' ? (
                  <AiErrorNote error={state.error} onRetry={retry} />
                ) : state.status === 'idle' ? (
                  // 답을 기다리다 다른 화면에 다녀온 경우.
                  <div className="coach-resume">
                    <p className="muted">이 질문은 아직 답을 받지 못했어요.</p>
                    <button type="button" className="btn" onClick={retry}>
                      다시 묻기
                    </button>
                  </div>
                ) : null}
              </li>
            )}
          </ol>
        )}

        <AiDisclaimer>
          코치의 답은 기록을 바탕으로 한 참고용이고 의학적 조언이 아니에요. 건강이 걱정되면 전문가와 상의해 주세요.
        </AiDisclaimer>
      </div>

      <form className="coach-composer" onSubmit={onSubmit}>
        <div className="coach-composer-row">
          <label className="coach-sr" htmlFor="coach-input">
            코치에게 물어볼 내용
          </label>
          <textarea
            id="coach-input"
            className="coach-input"
            rows={1}
            value={draft}
            maxLength={MAX_QUESTION}
            placeholder="궁금한 것을 적어 주세요"
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="btn btn--primary coach-send" disabled={waiting || draft.trim() === ''}>
            보내기
          </button>
        </div>
        {(remaining !== null || draft.length >= COUNTER_FROM) && (
          <p className="coach-meta small muted">
            <span data-testid="coach-quota">
              {remaining !== null && (
                <>
                  오늘 AI를 <span className="num">{remaining}</span>번 더 쓸 수 있어요
                </>
              )}
            </span>
            {draft.length >= COUNTER_FROM && (
              <span className="num" data-testid="coach-counter" aria-label={`${MAX_QUESTION}자 중 ${draft.length}자`}>
                {draft.length}/{MAX_QUESTION}
              </span>
            )}
          </p>
        )}
      </form>
      <div ref={endRef} aria-hidden="true" />
    </main>
  )
}
