import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { weightOn } from '../lib/selectors'
import { computeTrend, trendAt } from '../lib/trend'
import { useStore } from '../store'
import type { DateStr } from '../types'
import { fmtKg } from './today/format'
import './today/shared.css'
import './WeightCard.css'

const MIN_KG = 30
const MAX_KG = 300

/** 입력값을 소수 첫째 자리 kg으로 바꾼다. 범위를 벗어나거나 숫자가 아니면 null. */
function parseKg(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d*)?$/.test(t)) return null
  const kg = Math.round(Number(t) * 10) / 10
  return kg >= MIN_KG && kg <= MAX_KG ? kg : null
}

/** 날짜가 바뀌면 입력 상태를 비우도록 부모에서 key={date}로 렌더링한다. */
export default function WeightCard({ date }: { date: DateStr }) {
  const weights = useStore((s) => s.weights)
  const setWeight = useStore((s) => s.setWeight)
  const removeWeight = useStore((s) => s.removeWeight)

  const kg = useMemo(() => weightOn(weights, date), [weights, date])
  const trend = useMemo(() => trendAt(computeTrend(weights), date), [weights, date])

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const showForm = kg === null || editing
  const inputId = `weight-input-${date}`

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
      setEditing(false)
      setDraft('')
      setError(null)
    } catch {
      setError('저장하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseKg(draft)
    if (parsed === null) {
      setError(`${MIN_KG}~${MAX_KG} kg 사이의 숫자로 적어 주세요.`)
      return
    }
    void run(() => setWeight(date, parsed))
  }

  return (
    <section className="card weight" aria-labelledby="weight-card-title">
      <div className="weight-head">
        <h2 className="card-title" id="weight-card-title">
          체중
        </h2>
        {!showForm && (
          <button
            type="button"
            className="btn btn--ghost weight-edit"
            onClick={() => {
              setDraft(fmtKg(kg))
              setEditing(true)
            }}
          >
            <span aria-hidden="true">수정</span>
            <span className="visually-hidden">체중 수정</span>
          </button>
        )}
      </div>

      {showForm ? (
        <form onSubmit={onSubmit} noValidate>
          <div className="weight-form">
            <label className="visually-hidden" htmlFor={inputId}>
              체중 (kg)
            </label>
            <div className="weight-input-wrap">
              <input
                id={inputId}
                className="input num"
                inputMode="decimal"
                autoComplete="off"
                placeholder={kg === null ? '예: 72.4' : fmtKg(kg)}
                value={draft}
                autoFocus={editing}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${inputId}-error` : undefined}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setError(null)
                }}
              />
              <span className="weight-suffix" aria-hidden="true">
                kg
              </span>
            </div>
            <button type="submit" className="btn btn--primary" disabled={busy || draft.trim() === ''}>
              저장
            </button>
          </div>
          {error && (
            <p className="field-error weight-error" id={`${inputId}-error`} role="alert">
              {error}
            </p>
          )}
          {kg !== null && (
            <div className="weight-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setEditing(false)
                  setDraft('')
                  setError(null)
                }}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy}
                onClick={() => void run(() => removeWeight(date))}
              >
                체중 기록 삭제
              </button>
            </div>
          )}
        </form>
      ) : (
        <div className="weight-read">
          <p className="weight-value">
            <span data-testid="weight-value">{fmtKg(kg)}</span>
            <span className="unit">kg</span>
          </p>
          {trend !== null && (
            <p className="weight-trend">
              <span className="muted">추세</span>{' '}
              <b className="num" data-testid="weight-trend">
                {fmtKg(trend)}
              </b>{' '}
              kg
            </p>
          )}
        </div>
      )}
    </section>
  )
}
