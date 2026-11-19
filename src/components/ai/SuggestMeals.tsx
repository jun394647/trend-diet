import { useState, type FormEvent } from 'react'
import { useAiAvailability } from '../../ai/useAiAvailability'
import { useStore } from '../../store'
import type { DateStr } from '../../types'
import { AiConflictHint, AiDisclaimer, AiErrorNote, AiLimitNote, AiLoading, AiLoginHint, AiQuotaLeft, AiTag } from './AiBits'
import { isRetryable } from './CoachCall'
import { useCoachContext } from './CoachHooks'
import { MAX_WISH, logSuggestion, requestSuggestions, setSuggestWish, useSuggest } from './SuggestStore'
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
  const store = useSuggest()
  // 저장소에 남은 것이 오늘 것이 아니면 없는 것으로 본다.
  const mine = store.date === date
  const rows = mine ? store.rows : null
  const pending = mine && store.pending
  const error = mine ? store.error : null
  const [open, setOpen] = useState(rows !== null)
  const [logError, setLogError] = useState(false)

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
  const stale = rows !== null && store.logging.length === 0 && Math.abs(context.todayKcal - store.expectedKcal) >= 0.5
  const note = rows !== null ? store.note || (rows.length === 0 ? NO_MATCH : '') : ''
  // 실패 안내에 '다시 시도'가 있으면 같은 일을 하는 버튼을 하나 더 두지 않는다.
  const retryShown = error !== null && !pending && isRetryable(error)

  function ask() {
    if (!context || !canAsk) return
    setLogError(false)
    void requestSuggestions(date, context)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    ask()
  }

  async function onLog(index: number) {
    setLogError(false)
    const ok = await logSuggestion(index, (row, kcal) => addMeal({ date, kcal, name: row.name, source: 'ai' }))
    if (!ok) setLogError(true)
  }

  return (
    <div className={`suggest${open ? ' is-open' : ''}`}>
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
                placeholder="예: 편의점에서, 따뜻한 것"
                autoComplete="off"
                enterKeyHint="go"
                onChange={(e) => setSuggestWish(e.target.value)}
              />
              {!retryShown && (
                <button type="submit" className="btn" disabled={pending}>
                  {rows !== null ? '다른 추천 받기' : '추천 받기'}
                </button>
              )}
            </div>
            <p className="small muted">오늘 기록과 최근 2주 기록을 AI에 보내요.</p>
            <AiQuotaLeft />
          </form>
        )}
        {ai === 'limit' && <AiLimitNote fallback="식사는 그대로 기록할 수 있어요." />}

        {pending && <AiLoading label="남은 양에 맞는 식사를 찾는 중이에요" />}

        {error !== null && !pending && <AiErrorNote error={error} onRetry={canAsk ? ask : undefined} />}

        {rows !== null && !pending && (
          <>
            {stale && rows.length > 0 && <p className="small muted">기록이 바뀌기 전의 추천이에요.</p>}
            {rows.length > 0 && (
              <ul className={`list suggest-list${stale ? ' is-stale' : ''}`} aria-label="추천 식사">
                {rows.map((s, i) => {
                  const done = store.logged.includes(i)
                  const busy = store.logging.includes(i)
                  return (
                    <li key={`${i}|${s.name}`}>
                      <div className="suggest-item">
                        <p className="suggest-name">{s.name}</p>
                        <p className="suggest-kcal small num">{fmtKcal(s.kcal)} kcal</p>
                        <p className="small muted">{s.why}</p>
                      </div>
                      <button
                        type="button"
                        className="btn suggest-log"
                        disabled={done || busy}
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
            {note && <p className="suggest-note">{note}</p>}
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
