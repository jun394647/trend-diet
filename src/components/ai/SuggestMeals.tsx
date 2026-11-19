import { useState, type FormEvent } from 'react'
import type { AiRequest } from '../../ai/contract'
import { useAiCall } from '../../ai/useAiCall'
import { useStore } from '../../store'
import type { DateStr } from '../../types'
import { AiDisclaimer, AiErrorNote, AiLoading, AiTag } from './AiBits'
import { useCoachContext } from './CoachHooks'
import './SuggestMeals.css'

type SuggestRequest = Extract<AiRequest, { task: 'suggest' }>

const MAX_WISH = 100
const MAX_ROWS = 3
const fmtKcal = (n: number) => Math.round(n).toLocaleString('ko-KR')

/**
 * 오늘 남은 양에 맞는 다음 끼 추천. 접힌 한 줄로 있다가 누르면 펼쳐진다.
 * date는 오늘이어야 한다(남은 양을 기준으로 추천하므로). 오늘이 아닐 때는 화면에서 그리지 않는다.
 */
export default function SuggestMeals({ date }: { date: DateStr }) {
  const context = useCoachContext(date)
  const addMeal = useStore((s) => s.addMeal)
  const { state, run } = useAiCall<SuggestRequest>()
  const [open, setOpen] = useState(false)
  const [wish, setWish] = useState('')
  const [logged, setLogged] = useState<number[]>([])
  const [logError, setLogError] = useState(false)

  if (!context) return null

  const rows = state.status === 'done' ? state.data.suggestions.filter((s) => s.kcal > 0).slice(0, MAX_ROWS) : []
  const loading = state.status === 'loading'

  async function ask(avoid: string[]) {
    if (!context) return
    setLogged([])
    setLogError(false)
    // '다른 추천'일 때는 방금 본 것을 피해 달라고 바라는 점에 덧붙인다.
    const parts = [wish.trim(), avoid.length > 0 ? `방금 추천받은 ${avoid.join(', ')} 말고 다른 것` : ''].filter(Boolean)
    const text = parts.join(' / ').slice(0, MAX_WISH)
    await run({ task: 'suggest', context, ...(text ? { wish: text } : {}) })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return
    void ask(rows.map((r) => r.name))
  }

  async function onLog(index: number) {
    const s = rows[index]
    if (!s || logged.includes(index)) return
    setLogError(false)
    try {
      await addMeal({ date, kcal: Math.round(s.kcal), name: s.name, source: 'ai' })
      setLogged((prev) => [...prev, index])
    } catch {
      setLogError(true)
    }
  }

  return (
    <div className="suggest">
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

      {open && (
        <div className="suggest-body" id="suggest-body">
          <form className="suggest-form" onSubmit={onSubmit}>
            <label className="label" htmlFor="suggest-wish">
              바라는 점 <span className="suggest-optional">(안 적어도 돼요)</span>
            </label>
            <div className="suggest-form-row">
              <input
                id="suggest-wish"
                className="input"
                type="text"
                value={wish}
                maxLength={MAX_WISH}
                placeholder="예: 편의점에서, 따뜻한 것"
                autoComplete="off"
                enterKeyHint="go"
                onChange={(e) => setWish(e.target.value)}
              />
              <button type="submit" className="btn btn--primary" disabled={loading}>
                {state.status === 'done' ? '다른 추천' : '추천 받기'}
              </button>
            </div>
          </form>

          {loading && <AiLoading label="남은 양에 맞는 식사를 찾는 중이에요" />}

          {state.status === 'error' && <AiErrorNote error={state.error} onRetry={() => void ask([])} />}

          {state.status === 'done' && (
            <>
              {rows.length > 0 && (
                <ul className="list suggest-list" aria-label="추천 식사">
                  {rows.map((s, i) => {
                    const done = logged.includes(i)
                    return (
                      <li key={`${i}|${s.name}`}>
                        <div className="suggest-item">
                          <p className="suggest-item-head">
                            <span className="suggest-name">{s.name}</span>
                            <span className="suggest-kcal num">{fmtKcal(s.kcal)} kcal</span>
                          </p>
                          <p className="small muted">{s.why}</p>
                        </div>
                        <button
                          type="button"
                          className="btn suggest-log"
                          disabled={done}
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
              {state.data.note && <p className="suggest-note">{state.data.note}</p>}
              {logError && (
                <p className="field-error" role="alert">
                  기록하지 못했어요. 다시 시도해 주세요.
                </p>
              )}
              <AiDisclaimer />
            </>
          )}
        </div>
      )}
    </div>
  )
}
