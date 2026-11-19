import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAiAvailability } from '../../ai/useAiAvailability'
import { useStore } from '../../store'
import type { DateStr } from '../../types'
import { AiConflictHint, AiDisclaimer, AiErrorNote, AiLimitNote, AiLoginHint, AiQuotaLeft, AiTag } from './AiBits'
import { isRetryable } from './CoachCall'
import { useCoachContext } from './CoachHooks'
import { MAX_WISH, expectedKcal, logSuggestion, loggedRows, requestSuggestions, setSuggestWish, useSuggest } from './SuggestStore'
import './SuggestMeals.css'

const fmtKcal = (n: number) => Math.round(n).toLocaleString('ko-KR')
const NO_MATCH = '지금은 맞는 추천을 찾지 못했어요. 바라는 점을 바꿔서 다시 해 보세요.'

/**
 * 오늘 남은 양에 맞는 다음 끼 추천. 접힌 한 줄로 있다가 누르면 펼쳐진다.
 * date는 오늘이어야 한다(남은 양을 기준으로 추천하므로). 오늘이 아닐 때는 화면에서 그리지 않는다.
 * over는 오늘 이미 범위를 넘었는지. 그때는 덜 먹으라는 말처럼 들릴 수 있어 새로 권하지 않는다.
 */
export default function SuggestMeals({ date, over = false }: { date: DateStr; over?: boolean }) {
  const ai = useAiAvailability()
  const context = useCoachContext(date)
  const addMeal = useStore((s) => s.addMeal)
  const meals = useStore((s) => s.meals)
  const store = useSuggest()
  // 저장소에 남은 것이 오늘 것이 아니면 없는 것으로 본다.
  const mine = store.date === date
  const rows = mine ? store.rows : null
  const pending = mine && store.pending
  const error = mine ? store.error : null
  const [open, setOpen] = useState(rows !== null)
  const [logError, setLogError] = useState(false)

  // 기다리던 답이 이 화면에서 도착했을 때만 첫 추천(없으면 안내 문장)으로 초점을 옮긴다.
  // 그 사이 다른 곳을 쓰고 있었다면 초점을 빼앗지 않는다.
  const rootRef = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLParagraphElement>(null)
  const noteRef = useRef<HTMLParagraphElement>(null)
  const wasPending = useRef(pending)
  useEffect(() => {
    const arrived = wasPending.current && !pending && error === null && rows !== null
    wasPending.current = pending
    if (!arrived) return
    const active = document.activeElement
    if (active && active !== document.body && !rootRef.current?.contains(active)) return
    ;(firstRef.current ?? noteRef.current)?.focus()
  }, [pending, error, rows])

  if (ai === 'off' || !context) return null
  // 범위를 넘은 날에는 이미 받아 둔 추천만 보여 주고, 새로 권하지는 않는다.
  if (over && rows === null) return null
  if (ai === 'login') {
    return (
      <div className="suggest-hint">
        <AiLoginHint benefit="AI 식사 추천을 받을 수 있어요" />
      </div>
    )
  }
  if (ai === 'conflict') {
    return (
      <div className="suggest-hint">
        <AiConflictHint />
      </div>
    )
  }
  if (ai === 'limit' && rows === null) {
    return (
      <div className="suggest-hint">
        <AiLimitNote fallback="식사는 그대로 기록할 수 있어요." />
      </div>
    )
  }

  const canAsk = ai === 'ready' && !over
  // 추천을 눌러 기록한 것 말고 다른 기록이 바뀌었으면, 남은 양이 달라져 추천이 맞지 않을 수 있다.
  const stale = rows !== null && store.logging.length === 0 && Math.abs(context.todayKcal - expectedKcal(store, meals)) >= 0.5
  // 눌러서 기록한 추천. 저장소의 식사에서 찾으므로, 그 식사를 지우면 다시 기록할 수 있다.
  const logged = rows !== null ? loggedRows(store, meals) : []
  // AI의 한마디는 요청할 때의 남은 양을 말한다. 추천을 하나라도 기록한 뒤에는 맞지 않으므로 감춘다.
  const note = rows === null ? '' : rows.length === 0 ? store.note || NO_MATCH : logged.length > 0 ? '' : store.note
  // 횟수를 다 썼을 때는 횟수 안내만 보여 준다. 앞서 남은 실패 안내를 그 아래에 두지 않는다.
  const shownError = ai === 'limit' || pending ? null : error
  // 실패 안내에 '다시 시도'가 있으면 같은 일을 하는 버튼을 하나 더 두지 않는다.
  const retryShown = shownError !== null && isRetryable(shownError)

  function ask() {
    if (!context || !canAsk || pending) return
    setLogError(false)
    void requestSuggestions(date, context)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    ask()
  }

  async function onLog(index: number) {
    if (logged.includes(index) || store.logging.includes(index)) return
    setLogError(false)
    const ok = await logSuggestion(index, (row, kcal) => addMeal({ date, kcal, name: row.name, source: 'ai' }))
    if (!ok) setLogError(true)
  }

  return (
    <div className={`suggest${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="suggest-toggle"
        aria-expanded={open}
        aria-controls="suggest-body"
        onClick={() => setOpen((v) => !v)}
      >
        <AiTag />
        <span className="suggest-toggle-label">남은 양에 맞는 식사 추천</span>
        <svg
          className="suggest-chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* 접혀 있어도 그려 두고 감추기만 한다. 버튼의 aria-controls가 없는 요소를 가리키지 않게 하려는 것. */}
      <div className="suggest-body" id="suggest-body" hidden={!open}>
        {canAsk && (
          <form className="suggest-form" onSubmit={onSubmit}>
            <label className="label" htmlFor="suggest-wish">
              바라는 점<span className="ai-optional"> (안 적어도 돼요)</span>
            </label>
            <div className="suggest-form-row">
              <input
                id="suggest-wish"
                className="input"
                type="text"
                value={store.wish}
                maxLength={MAX_WISH}
                placeholder="예: 편의점, 따뜻한 것"
                autoComplete="off"
                enterKeyHint="go"
                onChange={(e) => setSuggestWish(e.target.value)}
              />
              {!retryShown && (
                // 기다리는 동안에도 초점을 잃지 않게 disabled 대신 aria-disabled로 막는다.
                <button type="submit" className="btn" aria-disabled={pending}>
                  {rows !== null ? '다른 추천 받기' : '추천 받기'}
                </button>
              )}
            </div>
            <p className="small muted">기본 정보와 최근 2주의 체중·식사 기록, 지금 계획을 AI에 보내요.</p>
            <AiQuotaLeft />
          </form>
        )}
        {ai === 'limit' && <AiLimitNote fallback="식사는 그대로 기록할 수 있어요." />}

        {/* 기다리는 말만 알리는 자리. 늘 그려 두어야 화면 낭독기가 새로 들어온 글을 읽는다. */}
        <div className="suggest-status" role="status">
          {pending && (
            <p className="ai-loading">
              <span className="ai-loading-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              남은 양에 맞는 식사를 찾는 중이에요
            </p>
          )}
        </div>

        {shownError !== null && <AiErrorNote error={shownError} onRetry={canAsk ? ask : undefined} />}

        {rows !== null && !pending && (
          <>
            {stale && rows.length > 0 && (
              <p className="small muted">기록이 바뀌기 전에 받은 추천이라 지금 남은 양과 다를 수 있어요.</p>
            )}
            {rows.length > 0 && (
              <ul className={`list suggest-list${stale ? ' is-stale' : ''}`} aria-label="추천 식사">
                {rows.map((s, i) => {
                  const done = logged.includes(i)
                  const busy = store.logging.includes(i)
                  return (
                    <li key={`${i}|${s.name}`}>
                      <div className="suggest-item">
                        <p className="suggest-name" ref={i === 0 ? firstRef : undefined} tabIndex={-1}>
                          {s.name}
                        </p>
                        <p className="suggest-kcal small num">{fmtKcal(s.kcal)} kcal</p>
                        <p className="small muted">{s.why}</p>
                      </div>
                      <button
                        type="button"
                        className="btn suggest-log"
                        // 누른 버튼이 '기록함'으로 바뀌어도 초점이 남도록 disabled 대신 aria-disabled로 막는다.
                        aria-disabled={done || busy}
                        aria-label={`${s.name} ${fmtKcal(s.kcal)} kcal ${done ? '기록함' : '기록'}`}
                        onClick={() => void onLog(i)}
                      >
                        {done ? '기록함' : '기록'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {note && (
              <p className="suggest-note" ref={noteRef} tabIndex={-1}>
                {note}
              </p>
            )}
            {logError && (
              <p className="field-error" role="alert">
                기록하지 못했어요. 다시 시도해 주세요.
              </p>
            )}
            {rows.length > 0 && <AiDisclaimer />}
          </>
        )}
      </div>
    </div>
  )
}
